// Sends notice text to Claude API and returns structured summary

async function generateNoticeSummary(noticeText, noticeMetadata, apiKey) {
  const prompt = `You are a senior Pakistani tax advisor at S. Saeed Tax Consultants, Islamabad.

Analyse the following FBR (Federal Board of Revenue) IRIS notice and provide a detailed structured summary.

NOTICE METADATA:
- Client Name: ${noticeMetadata.name}
- Registration No: ${noticeMetadata.regNo}
- Notice Type: ${noticeMetadata.task}
- Tax Year: ${noticeMetadata.taxYear}
- Period: ${noticeMetadata.period}
- Due Date: ${noticeMetadata.dueDate}
- Document Date: ${noticeMetadata.documentDate}
- Category: ${noticeMetadata.category}
- Section: ${noticeMetadata.section}

NOTICE TEXT:
${noticeText}

---

Provide your analysis in the following format:

## NOTICE SUMMARY

**Client:** [Name]
**Registration No:** [NTN/CNIC]
**Notice Type:** [Section number and title]
**Tax Year:** [Year]
**Period:** [Period]
**Document Date:** [Date]
**Due Date:** [Date — highlight if urgent, i.e. within 30 days]

---

## LEGAL SECTION ANALYSIS

[Explain what legal provision this notice is issued under, what it means under Pakistani tax law (Income Tax Ordinance 2001 / Sales Tax Act 1990 / etc.), and the implications for the taxpayer]

---

## KEY ALLEGATIONS / DEMANDS

[List all specific allegations, tax demands, amounts, and issues raised by FBR in this notice. Include all figures mentioned.]

---

## DEADLINES & URGENCY

[List all deadlines mentioned. Flag any that are past due or within 30 days as URGENT.]

---

## RECOMMENDED RESPONSE / ACTION

[Provide specific, practical advice on how S. Saeed Tax Consultants should respond to this notice. Include:
- What documents to gather
- What legal arguments to raise
- Whether to reply, appear, or file a return
- Draft response strategy
- Any relevant case law or FBR circulars if applicable]

---

## RISK ASSESSMENT

[Rate the risk level: LOW / MEDIUM / HIGH / CRITICAL — and explain why]`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// Extract risk level from summary text
function extractRiskLevel(summaryText) {
  const match = summaryText.match(/##\s*RISK ASSESSMENT[\s\S]*?(LOW|MEDIUM|HIGH|CRITICAL)/i);
  return match ? match[1].toUpperCase() : 'UNKNOWN';
}
