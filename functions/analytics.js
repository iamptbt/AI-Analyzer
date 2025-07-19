// functions/analytics.js

// This upgraded function handles two types of requests:
// 1. GET: To fetch a report and get an initial AI analysis.
// 2. POST: To answer a user's follow-up question about the fetched data.

const fetch = require('node-fetch');

// --- Main Serverless Function Handler ---
exports.handler = async (event, context) => {
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, GEMINI_API_KEY } = process.env;

  // --- Security and Configuration Validation ---
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN || !GEMINI_API_KEY) {
    const missingKeys = [
        !SHOPIFY_STORE_DOMAIN && "SHOPIFY_STORE_DOMAIN",
        !SHOPIFY_ACCESS_TOKEN && "SHOPIFY_ACCESS_TOKEN",
        !GEMINI_API_KEY && "GEMINI_API_KEY"
    ].filter(Boolean).join(', ');
    return { statusCode: 500, body: JSON.stringify({ error: `Server configuration error. Missing keys: ${missingKeys}` }) };
  }

  // --- Route based on HTTP Method ---
  if (event.httpMethod === 'POST') {
    // Handle follow-up questions from the AI Chat
    try {
      const body = JSON.parse(event.body);
      const { question, reportData, reportType } = body;
      if (!question || !reportData || !reportType) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing question or report data for chat." }) };
      }
      const chatAnswer = await getChatAnswer(question, reportData, reportType, GEMINI_API_KEY);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: chatAnswer }) };
    } catch (error) {
      console.error("Chat Handler Error:", error);
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
  } else {
    // Handle initial report fetching (GET request)
    try {
      const reportType = event.queryStringParameters.report || 'orders';
      const days = parseInt(event.queryStringParameters.days, 10) || 30;
      
      const shopifyData = await fetchFromShopify(SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, reportType, days);
      const initialAnalysis = await getInitialAnalysis(shopifyData, reportType, GEMINI_API_KEY);
      
      // IMPORTANT: Return BOTH the raw data and the AI analysis
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopifyData: shopifyData, analysis: initialAnalysis }),
      };
    } catch (error) {
      console.error("Report Fetch Error:", error);
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
  }
};


// --- Helper Function to Fetch from Shopify ---
async function fetchFromShopify(storeDomain, accessToken, reportType, days) {
  const sanitizedDomain = storeDomain.replace(/^(https?:\/\/)/, '');
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  const formatDate = (date) => date.toISOString();

  const apiVersion = '2024-07';
  let resource;
  let queryParams = new URLSearchParams({ limit: 250 });

  const timeBasedReports = ['orders', 'draft_orders', 'fulfillments', 'marketing_events'];
  if (timeBasedReports.includes(reportType)) {
      queryParams.set('status', 'any');
      queryParams.set('created_at_min', formatDate(startDate));
      queryParams.set('created_at_max', formatDate(endDate));
  }
  
  switch (reportType) {
    case 'products': resource = 'products'; break;
    case 'customers': resource = 'customers'; break;
    case 'draft_orders': resource = 'draft_orders'; break;
    case 'fulfillments': resource = 'fulfillments'; break;
    case 'locations': resource = 'locations'; break;
    case 'marketing_events': resource = 'marketing_events'; break;
    case 'themes': resource = 'themes'; break;
    case 'pages': resource = 'pages'; break;
    case 'script_tags': resource = 'script_tags'; break;
    case 'shipping_zones': resource = 'shipping_zones'; break;
    case 'companies': resource = 'companies'; break;
    case 'discounts': resource = 'price_rules'; break;
    case 'inventory_levels': resource = 'inventory_levels'; break;
    case 'orders': default: resource = 'orders'; break;
  }
  
  const apiUrl = `https://${sanitizedDomain}/admin/api/${apiVersion}/${resource}.json?${queryParams.toString()}`;

  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Shopify API Error for ${reportType}:`, errorText);
    throw new Error(`Shopify API request failed for report type '${reportType}' with status: ${response.status}.`);
  }
  return response.json();
}

// --- Helper for Initial AI Analysis ---
async function getInitialAnalysis(data, reportType, apiKey) {
  const prompt = generateInitialPrompt(data, reportType);
  return callGemini(prompt, apiKey);
}

// --- Helper for AI Chat Follow-ups ---
async function getChatAnswer(question, reportData, reportType, apiKey) {
    const prompt = generateChatPrompt(question, reportData, reportType);
    return callGemini(prompt, apiKey);
}

// --- Unified Gemini API Caller ---
async function callGemini(prompt, apiKey) {
  const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };

  const response = await fetch(geminiApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API Error:", errorText);
    throw new Error("The AI model failed to generate a response.");
  }

  const result = await response.json();
  if (result.candidates && result.candidates.length > 0) {
    return result.candidates[0].content.parts[0].text;
  } else {
    throw new Error("Received an empty or invalid response from the AI model.");
  }
}

// --- Prompt Generation Logic ---
function generateInitialPrompt(data, reportType) {
    const basePrompt = `You are an expert e-commerce data analyst. Based on the following raw JSON data from a Shopify store, provide a concise summary of actionable insights. Identify the top 3 most important highlights or anomalies. Present your findings in clear Markdown format. Use headings, bold text, and bullet points.`;
    let specificContext = '';
    let jsonData = JSON.stringify(data[Object.keys(data)[0]], null, 2);

    switch (reportType) {
        case 'orders': specificContext = `Focus on sales trends, average order value (AOV), and any unusual sales patterns.`; break;
        case 'products': specificContext = `Focus on top-selling products, inventory levels for popular items, and product categorization.`; break;
        case 'customers': specificContext = `Focus on identifying high-value customers, repeat purchase rates, and customer lifetime value.`; break;
        default: specificContext = `Provide a general analysis of the provided data.`; break;
    }
    return `${basePrompt}\n\nContext: ${specificContext}\n\nHere is the data:\n${jsonData}`;
}

function generateChatPrompt(question, reportData, reportType) {
    const basePrompt = `You are an expert e-commerce data analyst acting as a Q&A assistant. Your ONLY source of information is the JSON data provided below. Do not use outside knowledge or make assumptions. If the answer cannot be found in the data, you MUST say "I cannot answer that question with the provided data." Answer the user's question based on the data.`;
    let jsonData = JSON.stringify(reportData, null, 2);
    
    return `${basePrompt}\n\nDATA TYPE: ${reportType} report\n\nUSER QUESTION: "${question}"\n\nJSON DATA:\n${jsonData}`;
}
