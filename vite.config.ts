import React, { useState } from 'react';
import { 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  ShieldAlert, 
  ArrowRight, 
  FileText, 
  Clock, 
  Tag, 
  User, 
  RotateCcw,
  Sparkles
} from 'lucide-react';

interface Policy {
  id: string;
  title: string;
  category: string;
  policy_text: string;
  confidence_tag: string;
}

interface Claim {
  id: string;
  customer_id: string;
  item_value_usd: number;
  days_since_delivery: number;
  prior_claims_90d: number;
  claim_text: string;
  expected_type: string;
}

interface AdjudicationResult {
  decision: 'APPROVE' | 'DENY' | 'ESCALATE';
  matched_policy: string;
  policy_id: string;
  reason: string;
  retrieved_policies: string[];
}

const POLICIES: Policy[] = [
  {
    id: "pol-001",
    title: "Standard Return Window",
    category: "returns",
    policy_text: "Unworn, unused items may be returned within 30 days of delivery in their original packaging with proof of purchase. Refund is issued to the original payment method.",
    confidence_tag: "auto_resolve"
  },
  {
    id: "pol-002",
    title: "Defective Item Warranty",
    category: "warranty",
    policy_text: "Manufacturing defects are covered for 1 year. Claims under $75 may be approved from customer description alone. Claims of $75 or more require photo proof.",
    confidence_tag: "auto_resolve"
  },
  {
    id: "pol-003",
    title: "Final Sale and Clearance Exclusions",
    category: "returns",
    policy_text: "Items marked 'Final Sale' or purchased at a discount of 50% or more are not eligible for return or exchange under any circumstances.",
    confidence_tag: "auto_resolve"
  },
  {
    id: "pol-004",
    title: "High-Value Item Review",
    category: "escalation_policy",
    policy_text: "Any claim where item purchase value is $150 or more must be manually reviewed by the team lead before approval.",
    confidence_tag: "escalate_required"
  },
  {
    id: "pol-005",
    title: "Damaged in Shipping",
    category: "warranty",
    policy_text: "Items damaged in transit are covered if reported within 48 hours of delivery with photo proof. Replacement is shipped immediately.",
    confidence_tag: "auto_resolve"
  },
  {
    id: "pol-006",
    title: "Wrong Item Shipped",
    category: "returns",
    policy_text: "Prepaid return label issued for incorrect item; correct item shipped immediately. No time window restriction.",
    confidence_tag: "auto_resolve"
  },
  {
    id: "pol-007",
    title: "Size or Fit Exchange",
    category: "returns",
    policy_text: "Footwear and apparel may be exchanged for a different size within 45 days if unworn with tags attached. One free exchange per order.",
    confidence_tag: "auto_resolve"
  },
  {
    id: "pol-008",
    title: "Repeat Claim or Suspected Abuse",
    category: "escalation_policy",
    policy_text: "Customers who have submitted >3 claims within a rolling 90-day period must be flagged for manual review.",
    confidence_tag: "escalate_required"
  }
];

const INITIAL_CLAIMS: Claim[] = [
  {
    id: "claim-01",
    customer_id: "CUST-2001",
    item_value_usd: 89,
    days_since_delivery: 10,
    prior_claims_90d: 0,
    claim_text: "I bought hiking boots 10 days ago and they don't fit right - still have the tags on. Can I exchange them for a bigger size?",
    expected_type: "straightforward - size exchange"
  },
  {
    id: "claim-02",
    customer_id: "CUST-2002",
    item_value_usd: 60,
    days_since_delivery: 1,
    prior_claims_90d: 0,
    claim_text: "My tent arrived with a broken pole. I noticed it the day I unboxed it. This looks defective, I'd like a replacement.",
    expected_type: "straightforward - shipping damage / defect"
  },
  {
    id: "claim-03",
    customer_id: "CUST-2003",
    item_value_usd: 220,
    days_since_delivery: 21,
    prior_claims_90d: 0,
    claim_text: "I want to return this jacket. It's been about 3 weeks and I just don't like the color.",
    expected_type: "edge case - high value escalation"
  },
  {
    id: "claim-04",
    customer_id: "CUST-2004",
    item_value_usd: 45,
    days_since_delivery: 12,
    prior_claims_90d: 0,
    claim_text: "This sleeping bag was marked as clearance when I bought it, but it's too small. Can I return it?",
    expected_type: "straightforward - clearance exclusion"
  },
  {
    id: "claim-07",
    customer_id: "CUST-2007",
    item_value_usd: 55,
    days_since_delivery: 8,
    prior_claims_90d: 4,
    claim_text: "This is my fourth warranty claim this quarter for different items I've bought.",
    expected_type: "edge case - repeat claim abuse"
  },
  {
    id: "claim-08",
    customer_id: "CUST-2008",
    item_value_usd: 40,
    days_since_delivery: 58,
    prior_claims_90d: 0,
    claim_text: "My backpack's zipper broke after about 2 months of light use. I think it's a manufacturing defect. It was $40.",
    expected_type: "straightforward - defect under $75"
  }
];

export const ReturnsDashboard: React.FC = () => {
  const [selectedClaimId, setSelectedClaimId] = useState<string>(INITIAL_CLAIMS[0].id);

  const selectedClaim = INITIAL_CLAIMS.find((c) => c.id === selectedClaimId) || INITIAL_CLAIMS[0];

  const evaluateClaim = (claim: Claim): AdjudicationResult => {
    const text = claim.claim_text.toLowerCase();
    const retrieved: string[] = [];

    if (claim.prior_claims_90d > 3) retrieved.push("pol-008");
    if (claim.item_value_usd >= 150) retrieved.push("pol-004");
    if (text.includes("clearance") || text.includes("final sale")) retrieved.push("pol-003");
    if (text.includes("size") || text.includes("fit") || text.includes("boots")) retrieved.push("pol-007");
    if (text.includes("defect") || text.includes("broken") || text.includes("zipper")) retrieved.push("pol-002");
    if (text.includes("return") || text.includes("jacket")) retrieved.push("pol-001");

    if (claim.prior_claims_90d > 3) {
      return {
        decision: 'ESCALATE',
        policy_id: 'pol-008',
        matched_policy: 'Repeat Claim or Suspected Abuse',
        reason: `Customer has ${claim.prior_claims_90d} prior claims in 90 days (> 3 threshold).`,
        retrieved_policies: retrieved
      };
    }

    if (claim.item_value_usd >= 150) {
      return {
        decision: 'ESCALATE',
        policy_id: 'pol-004',
        matched_policy: 'High-Value Item Review',
        reason: `Item purchase value ($${claim.item_value_usd}) meets or exceeds the $150 threshold.`,
        retrieved_policies: retrieved
      };
    }

    if (text.includes("clearance") || text.includes("final sale")) {
      return {
        decision: 'DENY',
        policy_id: 'pol-003',
        matched_policy: 'Final Sale & Clearance Exclusions',
        reason: 'Items purchased on clearance or final sale are strictly non-returnable.',
        retrieved_policies: retrieved
      };
    }

    if ((text.includes("size") || text.includes("fit")) && claim.days_since_delivery <= 45) {
      return {
        decision: 'APPROVE',
        policy_id: 'pol-007',
        matched_policy: 'Size or Fit Exchange',
        reason: `Exchange requested within 45 days (${claim.days_since_delivery}d) with original tags.`,
        retrieved_policies: retrieved
      };
    }

    if ((text.includes("defect") || text.includes("broken")) && claim.days_since_delivery <= 365) {
      if (claim.item_value_usd < 75) {
        return {
          decision: 'APPROVE',
          policy_id: 'pol-002',
          matched_policy: 'Defective Item Warranty',
          reason: `Item value ($${claim.item_value_usd}) is under $75 warranty threshold, approved on description alone.`,
          retrieved_policies: retrieved
        };
      } else {
        return {
          decision: 'ESCALATE',
          policy_id: 'pol-002',
          matched_policy: 'Defective Item Warranty',
          reason: `Item value ($${claim.item_value_usd}) is >= $75; photo evidence must be verified by agent.`,
          retrieved_policies: retrieved
        };
      }
    }

    return {
      decision: 'ESCALATE',
      policy_id: 'pol-001',
      matched_policy: 'Standard Return Window',
      reason: 'Requires manual verification of item condition and timeline.',
      retrieved_policies: retrieved
    };
  };

  const adjudication = evaluateClaim(selectedClaim);

  const getDecisionBadge = (decision: string) => {
    switch (decision) {
      case 'APPROVE':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-4 h-4" /> Auto-Approved
          </span>
        );
      case 'DENY':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300">
            <XCircle className="w-4 h-4" /> Policy Denied
          </span>
        );
      case 'ESCALATE':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
            <ShieldAlert className="w-4 h-4" /> Manual Escalation
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      <header className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 font-semibold tracking-wide uppercase text-xs">
            <Sparkles className="w-4 h-4" /> Triage Engine POC
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white mt-1">Northwind Outdoor Gear Claims</h1>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-md">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Agent Active
          </div>
          <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-md">
            Queue: 4 Team Members
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Queue List */}
        <div className="lg:col-span-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Incoming Claims ({INITIAL_CLAIMS.length})
          </h2>
          {INITIAL_CLAIMS.map((claim) => {
            const adj = evaluateClaim(claim);
            const isSelected = claim.id === selectedClaim.id;
            return (
              <div
                key={claim.id}
                onClick={() => setSelectedClaimId(claim.id)}
                className={`p-4 rounded-xl border transition cursor-pointer text-left ${
                  isSelected 
                    ? 'bg-slate-900 border-emerald-500/70 shadow-lg shadow-emerald-950/40 ring-1 ring-emerald-500/40' 
                    : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-mono text-xs font-semibold text-slate-300">{claim.id}</span>
                  {getDecisionBadge(adj.decision)}
                </div>
                <p className="text-sm text-slate-200 line-clamp-2 mb-3">"{claim.claim_text}"</p>
                <div className="flex items-center gap-4 text-xs text-slate-400 font-mono">
                  <span>${claim.item_value_usd}</span>
                  <span>•</span>
                  <span>{claim.days_since_delivery}d ago</span>
                  <span>•</span>
                  <span>{claim.customer_id}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: Adjudication Detail */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-6">
              <div>
                <span className="text-xs font-mono text-emerald-400 uppercase">Selected Claim Overview</span>
                <h3 className="text-xl font-bold text-white">{selectedClaim.id}</h3>
              </div>
              {getDecisionBadge(adjudication.decision)}
            </div>

            {/* Claim Metadata Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-lg">
                <div className="text-slate-400 text-xs flex items-center gap-1 mb-1">
                  <Tag className="w-3.5 h-3.5" /> Item Value
                </div>
                <div className="text-base font-semibold text-white">${selectedClaim.item_value_usd}</div>
              </div>
              <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-lg">
                <div className="text-slate-400 text-xs flex items-center gap-1 mb-1">
                  <Clock className="w-3.5 h-3.5" /> Delivery Time
                </div>
                <div className="text-base font-semibold text-white">{selectedClaim.days_since_delivery} days</div>
              </div>
              <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-lg">
                <div className="text-slate-400 text-xs flex items-center gap-1 mb-1">
                  <User className="w-3.5 h-3.5" /> Customer
                </div>
                <div className="text-base font-semibold text-white">{selectedClaim.customer_id}</div>
              </div>
              <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-lg">
                <div className="text-slate-400 text-xs flex items-center gap-1 mb-1">
                  <RotateCcw className="w-3.5 h-3.5" /> Prior (90d)
                </div>
                <div className={`text-base font-semibold ${selectedClaim.prior_claims_90d > 3 ? 'text-rose-400 font-bold' : 'text-white'}`}>
                  {selectedClaim.prior_claims_90d} claims
                </div>
              </div>
            </div>

            {/* Customer Free Text */}
            <div className="mb-6">
              <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2 block">
                Customer Description
              </span>
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg text-slate-200 text-sm leading-relaxed italic">
                "{selectedClaim.claim_text}"
              </div>
            </div>

            {/* Agent Adjudication & Rationale */}
            <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-lg p-5 mb-6">
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold mb-2">
                <Sparkles className="w-4 h-4" /> Agent Decision & Guardrail Audit
              </div>
              <div className="text-sm font-semibold text-white mb-1">
                Matched Rule: <span className="text-emerald-300">{adjudication.matched_policy}</span> ({adjudication.policy_id})
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                {adjudication.reason}
              </p>
            </div>

            {/* Retrieved Policies (RAG Context) */}
            <div>
              <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3 block flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Retrieved Policy Knowledge Base Articles
              </span>
              <div className="space-y-2">
                {adjudication.retrieved_policies.map((pId) => {
                  const policy = POLICIES.find((p) => p.id === pId);
                  if (!policy) return null;
                  return (
                    <div key={policy.id} className="bg-slate-950 border border-slate-800/70 p-3.5 rounded-lg text-xs">
                      <div className="flex items-center justify-between text-slate-300 font-medium mb-1">
                        <span>{policy.title}</span>
                        <span className="font-mono text-slate-500">{policy.id}</span>
                      </div>
                      <p className="text-slate-400 leading-relaxed">{policy.policy_text}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action Bar */}
            <div className="mt-8 pt-4 border-t border-slate-800 flex justify-end gap-3">
              {adjudication.decision === 'APPROVE' && (
                <button className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition flex items-center gap-2">
                  Generate Return Label & RMA <ArrowRight className="w-4 h-4" />
                </button>
              )}
              {adjudication.decision === 'ESCALATE' && (
                <button className="bg-amber-600 hover:bg-amber-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition flex items-center gap-2">
                  Assign to Returns Lead <ArrowRight className="w-4 h-4" />
                </button>
              )}
              {adjudication.decision === 'DENY' && (
                <button className="bg-rose-600 hover:bg-rose-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition flex items-center gap-2">
                  Send Exclusion Notification <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReturnsDashboard;
