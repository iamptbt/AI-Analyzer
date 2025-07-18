// functions/analytics.js

// This file should be deployed as a serverless function (e.g., on Netlify or Vercel).
// It acts as a secure backend to fetch data from Shopify without exposing your API keys.

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // Your Shopify Store URL and Admin API Access Token must be stored as
  // environment variables on your deployment platform (e.g., Netlify).
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN } = process.env;

  // --- Security and Input Validation ---
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Shopify store credentials are not configured on the server.' }),
    };
  }

  // Calculate dates for the last 30 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 30);

  const formatDate = (date) => date.toISOString();

  // Construct the Shopify Admin API URL
  const apiVersion = '2024-07';
  const resource = 'orders'; // We are fetching orders for this app
  const queryParams = new URLSearchParams({
      status: 'any',
      created_at_min: formatDate(startDate),
      created_at_max: formatDate(endDate),
      limit: 250 // Fetch up to 250 recent orders
  });
  
  const apiUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${apiVersion}/${resource}.json?${queryParams.toString()}`;

  // --- API Request to Shopify ---
  try {
    const shopifyResponse = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
    });

    if (!shopifyResponse.ok) {
      const errorBody = await shopifyResponse.text();
      console.error('Shopify API Error:', errorBody);
      return {
        statusCode: shopifyResponse.status,
        body: JSON.stringify({ error: `Shopify API request failed: ${shopifyResponse.statusText}` }),
      };
    }

    const data = await shopifyResponse.json();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };

  } catch (error) {
    console.error('Error fetching from Shopify:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An internal server error occurred.' }),
    };
  }
};