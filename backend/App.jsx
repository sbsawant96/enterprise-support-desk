const runAdjudication = async () => {
  setLoading(true);
  setResult(null);

  try {
    const response = await fetch('http://localhost:8000/api/adjudicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: claimData.id,
        customer_id: claimData.customer_id,
        item_value_usd: parseFloat(claimData.item_value_usd),
        days_since_delivery: parseInt(claimData.days_since_delivery),
        prior_claims_90d: parseInt(claimData.prior_claims_90d),
        claim_text: claimData.claim_text
      })
    });

    if (!response.ok) throw new Error('API adjudication failed');
    const data = await response.json();
    setResult(data);
  } catch (err) {
    console.error(err);
  } finally {
    setLoading(false);
  }
};
