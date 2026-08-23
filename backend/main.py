import os
import time
import json
import logging
from typing import List, Literal, Optional
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from openai import AzureOpenAI
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.cosmos import CosmosClient
from opencensus.ext.azure.log_exporter import AzureLogHandler

# -----------------------------------------------------------------------------
# Configuration & Environment Variables
# -----------------------------------------------------------------------------
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "https://kadume1.openai.azure.com/")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "6bvsK9b8LiYcxyg4zPUU1eWjUeuhfe6kMktn1GFbADmAqNfz6PyyJQQJ99CHACYeBjFXJ3w3AAABACOGbXqv")
AZURE_OPENAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini")

AZURE_SEARCH_ENDPOINT = os.getenv("AZURE_SEARCH_ENDPOINT", "https://kadume1.search.windows.net")
AZURE_SEARCH_KEY = os.getenv("AZURE_SEARCH_KEY", "xQMnw6mHo2R3sGqyYECr3DsTWVCGIBuzkckXrEAjPDAzSeC6Qv1I")


COSMOS_ENDPOINT = os.getenv("COSMOS_ENDPOINT", "https://kadume.documents.azure.com:443/")
COSMOS_KEY = os.getenv("COSMOS_KEY", "6IUgLgSdlcztBbarfWqPHY21rHX9S9jSmDDbeV1DoCRHPSQMOJp5kELdHixSF48LTZUD9Tx4M69yACDbG11t0w==")
COSMOS_DATABASE = "NorthwindDB"
COSMOS_CONTAINER = "Adjudications"

APPINSIGHTS_CONN_STRING = os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=e4f5faa6-90aa-4e9e-9260-909f374b1a30;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;ApplicationId=25453f39-36c6-40f5-9070-ef59b39a0839")

# Telemetry / Logging Setup
logger = logging.getLogger("NorthwindAPIService")
logger.setLevel(logging.INFO)
if APPINSIGHTS_CONN_STRING:
    logger.addHandler(AzureLogHandler(connection_string=APPINSIGHTS_CONN_STRING))

# -----------------------------------------------------------------------------
# FastAPI App Initialization & CORS
# -----------------------------------------------------------------------------
app = FastAPI(
    title="Northwind Returns Adjudicator API",
    description="Backend service connecting Vite UI to Azure OpenAI, Azure Search, and Cosmos DB",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to Vite dev server (e.g. http://localhost:5173) in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------------------------------------------------------
# Seed Policy Knowledge Base (Embedded Fallback)
# -----------------------------------------------------------------------------
POLICIES = [
    {
        "id": "pol-001",
        "title": "Standard Return Window",
        "category": "returns",
        "policy_text": "Unworn, unused items may be returned within 30 days of delivery in their original packaging with proof of purchase. Refund is issued to the original payment method once received and inspected.",
        "confidence_tag": "auto_resolve"
    },
    {
        "id": "pol-002",
        "title": "Defective Item Warranty",
        "category": "warranty",
        "policy_text": "Manufacturing defects are covered for 1 year from the purchase date. Claims under $75 in item value may be approved from the customer's description alone. Claims of $75 or more require at least one photo showing the defect before approval.",
        "confidence_tag": "auto_resolve"
    },
    {
        "id": "pol-003",
        "title": "Final Sale and Clearance Exclusions",
        "category": "returns",
        "policy_text": "Items marked 'Final Sale' at checkout, or purchased at a discount of 50% or more off original price, are not eligible for return or exchange under any circumstances.",
        "confidence_tag": "auto_resolve"
    },
    {
        "id": "pol-004",
        "title": "High-Value Item Review",
        "category": "escalation_policy",
        "policy_text": "Any return or warranty claim where the item's purchase value is $150 or more must be manually reviewed by the returns team lead before approval, regardless of how clearly it meets other return or warranty criteria.",
        "confidence_tag": "escalate_required"
    },
    {
        "id": "pol-005",
        "title": "Damaged in Shipping",
        "category": "warranty",
        "policy_text": "Items damaged in transit are covered if reported within 48 hours of delivery, with at least one photo of the damage. A carrier claim is filed automatically and a replacement is shipped immediately at no cost.",
        "confidence_tag": "auto_resolve"
    },
    {
        "id": "pol-006",
        "title": "Wrong Item Shipped",
        "category": "returns",
        "policy_text": "If a customer receives a different item than what they ordered, a prepaid return label is issued for the incorrect item and the correct item is shipped immediately at no additional cost.",
        "confidence_tag": "auto_resolve"
    },
    {
        "id": "pol-007",
        "title": "Size or Fit Exchange",
        "category": "returns",
        "policy_text": "Footwear and apparel may be exchanged for a different size within 45 days of delivery if unworn with original tags still attached. Each order is eligible for one free size exchange.",
        "confidence_tag": "auto_resolve"
    },
    {
        "id": "pol-008",
        "title": "Repeat Claim or Suspected Abuse",
        "category": "escalation_policy",
        "policy_text": "Customers who have submitted more than 3 return or warranty claims within a rolling 90-day period must be flagged for manual review before any further claim from that customer is auto-approved.",
        "confidence_tag": "escalate_required"
    }
]

# -----------------------------------------------------------------------------
# Pydantic Schemas
# -----------------------------------------------------------------------------
class ClaimRequest(BaseModel):
    id: str = Field(..., example="claim-01")
    customer_id: str = Field(..., example="CUST-2001")
    item_value_usd: float = Field(..., example=89.0)
    days_since_delivery: int = Field(..., example=10)
    prior_claims_90d: int = Field(..., example=0)
    claim_text: str = Field(..., example="I bought hiking boots 10 days ago and they don't fit right - still have tags on.")

class PolicyItem(BaseModel):
    id: str
    title: str
    category: str
    policy_text: str
    confidence_tag: str

class AdjudicationResponse(BaseModel):
    claim_id: str
    decision: Literal["APPROVE", "DENY", "ESCALATE"]
    matched_policy_ids: List[str]
    reason: str
    confidence_score: float
    latency_ms: int

# -----------------------------------------------------------------------------
# Azure Integrations & Fallbacks
# -----------------------------------------------------------------------------
def search_policies(claim_text: str) -> List[dict]:
    """Retrieves policies from Azure AI Search index or falls back to keyword matching."""
    if AZURE_SEARCH_KEY and AZURE_SEARCH_ENDPOINT:
        try:
            search_client = SearchClient(
                endpoint=AZURE_SEARCH_ENDPOINT,
                index_name=AZURE_SEARCH_INDEX,
                credential=AzureKeyCredential(AZURE_SEARCH_KEY)
            )
            results = search_client.search(search_text=claim_text, top=4)
            docs = [doc for doc in results]
            if docs:
                return docs
        except Exception as e:
            logger.warning(f"Azure Search query failed, switching to local fallback: {e}")

    # Local Keyword / Guardrail Matcher
    retrieved = [p for p in POLICIES if p["category"] == "escalation_policy"]
    text_lower = claim_text.lower()
    
    kws = {
        "pol-001": ["return", "refund", "days"],
        "pol-002": ["defect", "broken", "zipper", "pole", "warranty"],
        "pol-003": ["clearance", "final sale", "sale", "discount"],
        "pol-005": ["damaged", "transit", "shipping", "unboxed"],
        "pol-006": ["wrong", "different", "sent me", "color"],
        "pol-007": ["size", "fit", "exchange", "tags", "boots", "shoes"]
    }
    
    for pid, terms in kws.items():
        if any(t in text_lower for t in terms):
            match = next((p for p in POLICIES if p["id"] == pid), None)
            if match and match not in retrieved:
                retrieved.append(match)
                
    return retrieved

def persist_to_cosmos(record: dict):
    """Asynchronously or synchronously writes adjudication records to Cosmos DB."""
    if not (COSMOS_KEY and COSMOS_ENDPOINT):
        return
    try:
        client = CosmosClient(COSMOS_ENDPOINT, credential=COSMOS_KEY)
        db = client.get_database_client(COSMOS_DATABASE)
        container = db.get_container_client(COSMOS_CONTAINER)
        container.upsert_item(record)
    except Exception as e:
        logger.error(f"Failed writing audit trail to Cosmos DB: {e}")

# -----------------------------------------------------------------------------
# API Endpoints
# -----------------------------------------------------------------------------
@app.get("/api/policies", response_model=List[PolicyItem])
def get_all_policies():
    """Returns the grounded knowledge base policies."""
    return POLICIES

@app.post("/api/adjudicate", response_model=AdjudicationResponse)
def adjudicate_claim(claim: ClaimRequest):
    """Evaluates claim against Azure AI Search context and executes Azure OpenAI triage."""
    start_time = time.time()
    
    # 1. Retrieve Knowledge Grounding
    retrieved_policies = search_policies(claim.claim_text)
    policy_context = "\n".join([f"- [{p['id']}] {p['title']}: {p['policy_text']}" for p in retrieved_policies])

    # 2. Invoke Azure OpenAI (or Fallback Engine)
    system_prompt = """You are the Northwind Outdoor Gear Policy Adjudicator.
Evaluate return and warranty claims strictly against the provided policy context and order metadata.

Decisions:
- "APPROVE": Clearly meets policy, within time/cost bounds, no escalation tags triggered.
- "DENY": Excluded by policy (e.g., clearance/final sale, outside allowed window).
- "ESCALATE": Meets high-value thresholds ($150+), customer abuse limits (>3 claims in 90d), requires photos ($75+ defect), or contains ambiguous circumstances.

Output ONLY valid JSON strictly matching:
{
  "decision": "APPROVE" | "DENY" | "ESCALATE",
  "matched_policy_ids": ["pol-xxx"],
  "reason": "Clear, concise 1-2 sentence explanation citing exact policy numbers and claim facts.",
  "confidence_score": 0.95
}"""

    user_payload = {
        "claim_id": claim.id,
        "customer_id": claim.customer_id,
        "item_value_usd": claim.item_value_usd,
        "days_since_delivery": claim.days_since_delivery,
        "prior_claims_90d": claim.prior_claims_90d,
        "claim_text": claim.claim_text,
        "retrieved_policies": policy_context
    }

    try:
        if not AZURE_OPENAI_API_KEY:
            raise ValueError("No Azure OpenAI API key provided.")

        aoai_client = AzureOpenAI(
            azure_endpoint=AZURE_OPENAI_ENDPOINT,
            api_key=AZURE_OPENAI_API_KEY,
            api_version="2024-02-15-preview"
        )
        response = aoai_client.chat.completions.create(
            model=AZURE_OPENAI_DEPLOYMENT,
            response_format={"type": "json_object"},
            temperature=0.0,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload, indent=2)}
            ]
        )
        model_result = json.loads(response.choices[0].message.content)
    except Exception as e:
        logger.warning(f"Azure OpenAI unavailable or errored ({e}). Running deterministic policy engine.")
        # Programmatic fallback logic
        if claim.prior_claims_90d > 3:
            model_result = {
                "decision": "ESCALATE",
                "matched_policy_ids": ["pol-008"],
                "reason": f"Customer has submitted {claim.prior_claims_90d} prior claims in 90 days, exceeding the limit of 3 under pol-008.",
                "confidence_score": 0.99
            }
        elif claim.item_value_usd >= 150:
            model_result = {
                "decision": "ESCALATE",
                "matched_policy_ids": ["pol-004"],
                "reason": f"Item value of ${claim.item_value_usd} meets or exceeds the $150 threshold requiring lead review under pol-004.",
                "confidence_score": 0.98
            }
        elif "clearance" in claim.claim_text.lower() or "final sale" in claim.claim_text.lower():
            model_result = {
                "decision": "DENY",
                "matched_policy_ids": ["pol-003"],
                "reason": "Clearance items are strictly non-returnable and excluded from refunds under pol-003.",
                "confidence_score": 0.99
            }
        elif any(k in claim.claim_text.lower() for k in ["size", "fit", "exchange", "boots", "shoes"]):
            if claim.days_since_delivery <= 45:
                model_result = {
                    "decision": "APPROVE",
                    "matched_policy_ids": ["pol-007"],
                    "reason": f"Size exchange request submitted within 45 days ({claim.days_since_delivery} days elapsed) under pol-007.",
                    "confidence_score": 0.95
                }
            else:
                model_result = {
                    "decision": "DENY",
                    "matched_policy_ids": ["pol-007"],
                    "reason": f"Exchange requested after {claim.days_since_delivery} days, exceeding the 45-day window under pol-007.",
                    "confidence_score": 0.92
                }
        else:
            if claim.days_since_delivery <= 30:
                model_result = {
                    "decision": "APPROVE",
                    "matched_policy_ids": ["pol-001"],
                    "reason": f"Return requested within standard 30-day window ({claim.days_since_delivery} days elapsed) under pol-001.",
                    "confidence_score": 0.94
                }
            else:
                model_result = {
                    "decision": "DENY",
                    "matched_policy_ids": ["pol-001"],
                    "reason": f"Return requested after {claim.days_since_delivery} days, exceeding the 30-day policy under pol-001.",
                    "confidence_score": 0.95
                }

    latency = int((time.time() - start_time) * 1000)

    # 3. Assemble Response
    response_payload = AdjudicationResponse(
        claim_id=claim.id,
        decision=model_result["decision"],
        matched_policy_ids=model_result["matched_policy_ids"],
        reason=model_result["reason"],
        confidence_score=float(model_result.get("confidence_score", 0.90)),
        latency_ms=latency
    )

    # 4. Cosmos DB Audit Logging & App Insights Event
    audit_record = {
        "id": f"{claim.id}-{int(time.time())}",
        "claim": claim.dict(),
        "decision": response_payload.dict()
    }
    persist_to_cosmos(audit_record)
    logger.info(f"Adjudication processed for {claim.id}: {response_payload.decision} in {latency}ms")

    return response_payload
