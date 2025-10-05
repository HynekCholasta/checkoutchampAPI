// api_server.js
// Express API server for CheckoutChamp scraper
// Usage: node api_server.js
// Endpoint: POST /api/auth with header "X-API-Token: your-secret-token-here"

const express = require('express');
const { chromium } = require('playwright');
require('dotenv').config(); // For environment variables

const app = express();
app.use(express.json());

// Configuration from environment variables
const PORT = process.env.PORT;
const API_TOKEN = process.env.API_TOKEN;
const CHECKOUTCHAMP_USER = process.env.CHECKOUTCHAMP_USER;
const CHECKOUTCHAMP_PASS = process.env.CHECKOUTCHAMP_PASS;

// Middleware to verify API token
function verifyApiToken(req, res, next) {
  const token = req.headers['x-api-token'];
  
  if (!token) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Missing X-API-Token header' 
    });
  }
  
  if (token !== API_TOKEN) {
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'Invalid API token' 
    });
  }
  
  next();
}

// Main scraper function
async function getCheckoutChampAuth() {
  const USER = CHECKOUTCHAMP_USER;
  const PASS = CHECKOUTCHAMP_PASS;
  
  if (!USER || !PASS) {
    throw new Error('Missing CHECKOUTCHAMP_USER or CHECKOUTCHAMP_PASS environment variables');
  }

  const BASE = 'https://crm.checkoutchamp.com';
  const LOGIN_URL = `${BASE}/`;
  const DASHBOARD_URL_PART = '/dashboard';
  const DATA_ENDPOINT = `${BASE}/reports/order-details/getTable.ajax.php`;

  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Required for some cloud environments
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();

  try {
    // 1) Open login page
    console.log('Loading login page...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 2) Fill credentials and submit
    console.log('Logging in...');
    await page.fill('input[name="userName"]', USER, { timeout: 5000 });
    await page.fill('input[name="password"]', PASS, { timeout: 5000 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => null),
      page.click('#loginBtn')
    ]);

    await page.waitForTimeout(2000);

    // 3) Verify login
    const currentURL = page.url();
    let loggedIn = currentURL.includes(DASHBOARD_URL_PART) || (await page.$('body >> text=reports') !== null);

    if (!loggedIn) {
      await page.goto(`${BASE}/dashboard/`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => null);
      const url2 = page.url();
      loggedIn = url2.includes(DASHBOARD_URL_PART) || (await page.$('body >> text=reports') !== null);
    }

    if (!loggedIn) {
      throw new Error('Login failed - could not reach dashboard');
    }

    console.log('Login successful');

    // 4) Extract cookies
    const cookies = await context.cookies();
    const crmid = cookies.find(c => c.name === 'crmid');
    const k_region = cookies.find(c => c.name === 'k_region');
    const __cf_bm = cookies.find(c => c.name === '__cf_bm');

    // 5) Extract CSRF token and company ID
    const authData = await page.evaluate(() => {
      let csrf = null;
      let companyId = null;
      
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const text = script.textContent;
        
        const adomMatch = text.match(/aDom\.construct\s*\(\s*\{([^}]+)\}\s*\)/);
        if (adomMatch) {
          const configStr = adomMatch[1];
          
          const csrfMatch = configStr.match(/['"]?csrfToken['"]?\s*:\s*['"]([^'"]+)['"]/);
          if (csrfMatch && !csrf) csrf = csrfMatch[1];
          
          const companyMatch = configStr.match(/['"]?currentCompanyId['"]?\s*:\s*['"](\d+)['"]/);
          if (companyMatch && !companyId) companyId = companyMatch[1];
        }
      }

      return { csrf, companyId };
    });

    await browser.close();

    // 6) Build response
    const authVariables = {
      cookies: {
        crmid: crmid?.value || null,
        k_region: k_region?.value || null,
        __cf_bm: __cf_bm?.value || null,
        all_cookies: cookies
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-COMPANY-ID': authData.companyId || '4623',
        'X-CSRF-Token': authData.csrf || null,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Referer': 'https://crm.checkoutchamp.com/reports/order-details/',
        'Origin': 'https://crm.checkoutchamp.com'
      },
      endpoints: {
        base_url: BASE,
        login_url: LOGIN_URL,
        data_endpoint: DATA_ENDPOINT,
        chart_endpoint: `${BASE}/reports/order-details/getChart.ajax.php`
      },
      session_info: {
        timestamp: new Date().toISOString(),
        username: USER,
        company_id: authData.companyId || '4623',
        session_timeout_minutes: 240
      }
    };

    return authVariables;

  } catch (error) {
    await browser.close();
    throw error;
  }
}

// API endpoint
app.post('/api/auth', verifyApiToken, async (req, res) => {
  try {
    console.log('Received auth request...');
    const authData = await getCheckoutChampAuth();
    res.json(authData);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`CheckoutChamp Auth API running on port ${PORT}`);
  console.log(`API Token: ${API_TOKEN}`);
  console.log(`Usage: POST /api/auth with header "X-API-Token: ${API_TOKEN}"`);
});