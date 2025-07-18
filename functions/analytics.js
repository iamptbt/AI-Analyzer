// functions/analytics.js

// This function now handles various report types and date ranges.
// It fetches the appropriate data from Shopify and generates a custom
// prompt for the Gemini AI to provide specific insights.

const fetch = require('node-fetch');

// --- Main Serverless Function Handler ---
exports.handler = async (event, context) => {
  // Get secrets from Netlify environment variables
  const {
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_ACCESS_TOKEN,
    GEMINI_API_KEY
  } = process.env;

  // --- Security and Input Validation ---
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN || !GEMINI_API_KEY) {
    const missingKeys = [
        !SHOPIFY_STORE_DOMAIN && "SHOPIFY_STORE_DOMAIN",
        !SHOPIFY_ACCESS_TOKEN && "SHOPIFY_ACCESS_TOKEN",
        !GEMINI_API_KEY && "GEMINI_API_KEY"
    ].filter(Boolean).join(', ');

    return {
      statusCode: 500,
      body: JSON.stringify({ error: `The following required environment variables are not configured on the server: ${missingKeys}` }),
    };
  }

  // --- Get Parameters from Front-End Request ---
  const reportType = event.queryStringParameters.report || 'orders';
  const days = parseInt(event.queryStringParameters.days, 10) || 30;

  try {
    // --- Step 1: Fetch Data from Shopify based on report type ---
    const shopifyData = await fetchFromShopify(SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, reportType, days);

    // --- Step 2: Get Analysis from Gemini AI ---
    const aiAnalysis = await getAiAnalysis(shopifyData, reportType, GEMINI_API_KEY);
    
    // --- Step 3: Return the AI's analysis to the front-end ---
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis: aiAnalysis }),
    };

  } catch (error) {
    console.error("Handler Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
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
  let queryParams = new URLSearchParams({ limit: 250 }); // Default limit

  // Time-based reports use date range
  const timeBasedReports = ['orders', 'draft_orders', 'fulfillments', 'marketing_events'];
  if (timeBasedReports.includes(reportType)) {
      queryParams.set('status', 'any');
      queryParams.set('created_at_min', formatDate(startDate));
      queryParams.set('created_at_max', formatDate(endDate));
  }
  
  // Set the resource based on the report type
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
    case 'discounts': resource = 'price_rules'; break; // Discounts are called Price Rules in the API
    case 'inventory_levels': resource = 'inventory_levels'; break; // Note: This requires inventory_item_ids
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
    throw new Error(`Shopify API request failed for report type '${reportType}' with status: ${response.status}. Please check your app permissions.`);
  }
  return response.json();
}


// --- Helper Function to Call Gemini AI ---
async function getAiAnalysis(data, reportType, apiKey) {
  const prompt = generateAiPrompt(data, reportType);
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
function generateAiPrompt(data, reportType) {
    const basePrompt = `You are an expert e-commerce data analyst for a Shopify store. Based on the following raw JSON data, provide a concise summary of actionable insights. Present your findings in clear Markdown format. Use headings, bold text, and bullet points.`;
    let specificPrompt = '';
    let jsonData = JSON.stringify(data[Object.keys(data)[0]], null, 2); // Get the data from the first key (e.g., data.orders)

    switch (reportType) {
        case 'products':
            specificPrompt = `The data contains a list of products. Analyze inventory levels, product types, and vendor information to identify top sellers, potential stock issues, and opportunities for product bundling or marketing.`;
            break;
        case 'customers':
            specificPrompt = `The data contains a list of customers. Analyze their order counts, total spending, and location to identify high-value customers, repeat buyers, and potential geographic markets for targeted campaigns.`;
            break;
        case 'discounts':
            specificPrompt = `The data contains a list of discount codes (Price Rules). Analyze their usage, the types of discounts offered (e.g., percentage, fixed amount), and target selections to evaluate the effectiveness of promotional strategies.`;
            break;
        case 'fulfillments':
            specificPrompt = `The data contains a list of fulfillments. Analyze the time-to-fulfill (time between creation and update), fulfillment services used, and tracking information to identify bottlenecks or inefficiencies in the shipping process.`;
            break;
        case 'locations':
            specificPrompt = `The data contains a list of store locations. Analyze whether they are active and have inventory. Provide insights on inventory distribution if possible.`;
            break;
        case 'themes':
            specificPrompt = `The data contains a list of installed themes. Identify the currently published theme ('role: "main"'). Comment on the number of unpublished themes and suggest best practices for theme management.`;
            break;
        case 'pages':
            specificPrompt = `The data contains a list of content pages. Analyze the titles and publication status. Suggest opportunities for new content (like FAQs, About Us) or improving existing pages for SEO.`;
            break;
        case 'shipping_zones':
            specificPrompt = `The data contains shipping zones and rates. Analyze the different zones, countries, and shipping price points. Identify if there are opportunities to offer better shipping rates or if any zones seem overly complex.`;
            break;
        case 'inventory_levels':
            specificPrompt = `The data contains inventory levels. This is raw data linking inventory item IDs to locations. Summarize which locations have inventory and point out any items that might be low on stock across all locations.`;
            break;
        case 'orders':
        default:
            specificPrompt = `The data contains a list of orders. Analyze sales trends, average order value (AOV), top sales channels, and payment methods to provide a comprehensive overview of sales performance.`;
            break;
    }
    return `${basePrompt}\n\n${specificPrompt}\n\nHere is the data:\n${jsonData}`;
}
