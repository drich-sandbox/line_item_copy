# Setup guide (no coding experience needed)

You will do five things: make two free accounts, put this code on your computer, publish the backend, register the app in HubSpot, and test it in a workflow. Budget about 60 to 90 minutes. If any step shows an error, copy the exact text and send it to me.

Important: the code in this repo was written without being able to test against a live HubSpot account. The HubSpot config files are the most likely place for a small error on first upload. That is normal and usually a one-line fix.

## What the pieces are

- **Backend (the `worker` folder):** a tiny program hosted free on Cloudflare. HubSpot calls it when a workflow reaches your action. It does the copying.
- **HubSpot app (the `hubspot` folder):** tells HubSpot the action exists, what fields it has, and where the backend lives.
- HubSpot's own free hosting (serverless functions) cannot be used here because it does not work with apps that use OAuth, which any app installable in many accounts needs. That is why we use Cloudflare.

## Step 1: Install the tools (once)

1. Install Node.js (the "LTS" version) from https://nodejs.org and run the installer with defaults.
2. Install Git from https://git-scm.com/downloads (defaults are fine).
3. Open a terminal. On Windows, search for "PowerShell". On Mac, search for "Terminal".
4. Check it worked: type `node -v` and press Enter. You should see a version number.
5. Install the HubSpot CLI: `npm install -g @hubspot/cli@latest`

## Step 2: Get the code onto your computer

1. In your terminal run (this downloads your repo): `git clone https://github.com/drich-sandbox/line_item_copy.git`
2. Then: `cd line_item_copy`
3. Switch to the branch with the code: `git checkout claude/keen-dijkstra-hd2plq`

(Later, to make this the main version, open a pull request on GitHub and merge it. I can do that when you ask.)

## Step 3: Make accounts

1. Cloudflare: sign up free at https://dash.cloudflare.com/sign-up. No credit card needed.
2. HubSpot developer account: go to https://developers.hubspot.com, click "Get started free", and sign up. This is separate from your normal HubSpot login.
3. In the developer account, create a **test account** (Test accounts, then Create developer test account). Test accounts are free, can use Professional/Enterprise features, and let you try the app without touching real data. Workflows need Operations Hub or Sales Hub Professional, so use a test account that has them.

## Step 4: Publish the backend on Cloudflare

In the terminal, from the `line_item_copy` folder:

1. `cd worker`
2. `npm install`
3. `npx wrangler login` (a browser opens, click Allow)
4. Create the storage: `npx wrangler kv namespace create TOKENS`. It prints an `id`. Open `worker/wrangler.toml` in Notepad or TextEdit and replace `PASTE_KV_ID_HERE` with that id. Save.
5. `npx wrangler deploy`. It prints a web address like `https://line-item-copy.yourname.workers.dev`. **Copy it. This is your WORKER URL.**
6. Open `https://YOUR-WORKER-URL/` in a browser. You should see "Line Item Copy app is running."

## Step 5: Register the app in HubSpot

1. Open `hubspot/src/app/app-hsmeta.json` in a text editor. Replace `https://YOUR-WORKER-URL/oauth/callback` with your real worker URL (keep the `/oauth/callback` ending) and `YOUR-EMAIL` with your email. Save.
2. Open `hubspot/src/app/workflow-actions/copy-line-items-hsmeta.json`. Replace `https://YOUR-WORKER-URL/action/copy-line-items` the same way. Save.
3. In the terminal: `cd ../hubspot` (from `worker`), then `hs account auth`. Follow the prompts and choose your **developer account**.
4. `hs project upload`. If it reports errors, send them to me.
5. In HubSpot go to your developer account, then Development, then Projects, open `line-item-copy`, then the app. Find the **Auth** tab and copy the **Client ID** and **Client secret**. Also copy the **Install URL**.

## Step 6: Give the backend its HubSpot keys

Back in the `worker` folder in the terminal:

1. `npx wrangler secret put HUBSPOT_CLIENT_ID`, paste the Client ID, Enter.
2. `npx wrangler secret put HUBSPOT_CLIENT_SECRET`, paste the secret, Enter.

Never paste these into a file or commit them to GitHub.

## Step 7: Install into your test account and try it

1. Open the Install URL from Step 5 in your browser, pick your test account, and approve. You should land on a page that says "Installed!".
2. In the test account, create two deals. Add a couple of line items to one of them.
3. Go to Automation, then Workflows, create a deal-based workflow, and enroll the deal with line items.
4. Add an action, find **Copy line items to another deal**. Type the second deal's ID in "Target deal ID" (the ID is the number at the end of the deal's URL), or pick a deal property that stores an ID. In a workflow that creates a deal first, choose the "Create record" output ID instead.
5. Pick whether to keep or replace existing line items, turn the workflow on, and enroll the first deal.
6. Open the second deal. The line items should be there.

If it fails, in the workflow open History for the error, and run `npx wrangler tail` in the `worker` folder to watch the backend log live.

Note: the action is saved with `"isPublished": false`, which means it shows only in the developer account that owns it. That is correct for testing.

## Step 8: Later, for the Marketplace

HubSpot requires an app to be installed by several real accounts, pass a security and quality review, and have a listing (logo, description, privacy policy, support page). We can add that once Step 7 works. Do not worry about it yet.

## Privacy note

This app only reads and writes line items and deals in the HubSpot account that installs it, and stores one login token per account. Avoid putting customer personal data into anything you paste to an AI assistant while debugging. Deal and line item IDs are fine to share, names and emails are not.
