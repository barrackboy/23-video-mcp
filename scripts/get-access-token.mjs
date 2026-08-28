#!/usr/bin/env node
// Interactive helper for the TwentyThree OAuth 1.0a "three-legged" flow.
// Exchanges your consumer key/secret for a permanent access token + secret,
// and writes the results into ../.env automatically.
//
// Usage (run from the twentythree-mcp-server project root, in your own terminal —
// this needs real internet access, not a sandboxed shell):
//   node scripts/get-access-token.mjs
//
// Requires TWENTYTHREE_CONSUMER_KEY and TWENTYTHREE_CONSUMER_SECRET to already
// be set in .env.

import "dotenv/config";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, "..", ".env");

const OAUTH_BASE = "https://api.visualplatform.net/oauth";

const CONSUMER_KEY = process.env.TWENTYTHREE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.TWENTYTHREE_CONSUMER_SECRET;

if (!CONSUMER_KEY || !CONSUMER_SECRET) {
  console.error(
    "Set TWENTYTHREE_CONSUMER_KEY and TWENTYTHREE_CONSUMER_SECRET in .env first."
  );
  process.exit(1);
}

function percentEncode(str) {
  return encodeURIComponent(str).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function sign(method, url, params, tokenSecret = "") {
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join("&");
  const signingKey = `${percentEncode(CONSUMER_SECRET)}&${percentEncode(tokenSecret)}`;
  return crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");
}

function oauthBaseParams() {
  return {
    oauth_consumer_key: CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
  };
}

function parseFormEncoded(text) {
  const out = {};
  for (const pair of text.trim().split("&")) {
    if (!pair) continue;
    const [k, v] = pair.split("=");
    out[decodeURIComponent(k)] = decodeURIComponent(v || "");
  }
  return out;
}

async function requestToken() {
  const url = `${OAUTH_BASE}/request_token`;
  const params = { ...oauthBaseParams(), oauth_callback: "oob" };
  params.oauth_signature = sign("GET", url, params);
  const res = await axios.get(url, { params });
  return parseFormEncoded(typeof res.data === "string" ? res.data : JSON.stringify(res.data));
}

async function exchangeAccessToken(requestTokenValue, requestTokenSecret, verifier) {
  const url = `${OAUTH_BASE}/access_token`;
  const params = {
    ...oauthBaseParams(),
    oauth_token: requestTokenValue,
    oauth_verifier: verifier,
  };
  params.oauth_signature = sign("GET", url, params, requestTokenSecret);
  const res = await axios.get(url, { params });
  return parseFormEncoded(typeof res.data === "string" ? res.data : JSON.stringify(res.data));
}

function updateEnvFile(updates) {
  let content = fs.readFileSync(ENV_PATH, "utf8");
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(content)) {
      content = content.replace(re, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }
  fs.writeFileSync(ENV_PATH, content);
}

async function main() {
  console.log("Requesting a temporary request token...");
  const reqTok = await requestToken();
  if (!reqTok.oauth_token || !reqTok.oauth_token_secret) {
    console.error("Failed to get a request token. Response:", reqTok);
    process.exit(1);
  }

  const authorizeUrl = `${OAUTH_BASE}/authorize?oauth_token=${encodeURIComponent(
    reqTok.oauth_token
  )}`;
  console.log("\nOpen this URL in your browser, log in, and approve access:\n");
  console.log("  " + authorizeUrl);
  console.log("\nAfter approving, TwentyThree will show you a verification code.");

  const rl = readline.createInterface({ input, output });
  const verifier = (await rl.question("Paste the verification code here: ")).trim();
  rl.close();

  console.log("\nExchanging for a permanent access token...");
  const accTok = await exchangeAccessToken(
    reqTok.oauth_token,
    reqTok.oauth_token_secret,
    verifier
  );

  if (!accTok.oauth_token || !accTok.oauth_token_secret) {
    console.error("Failed to get an access token. Response:", accTok);
    process.exit(1);
  }

  console.log("\nSuccess! Access token acquired.");
  console.log("oauth_token:", accTok.oauth_token);
  console.log("oauth_token_secret:", accTok.oauth_token_secret);
  if (accTok.domain) console.log("domain:", accTok.domain);
  if (accTok.user_id) console.log("user_id:", accTok.user_id);

  const updates = {
    TWENTYTHREE_ACCESS_TOKEN: accTok.oauth_token,
    TWENTYTHREE_ACCESS_TOKEN_SECRET: accTok.oauth_token_secret,
  };
  if (accTok.domain) updates.TWENTYTHREE_DOMAIN = accTok.domain;

  updateEnvFile(updates);
  console.log("\n.env has been updated with the new access token (and domain, if provided).");
}

main().catch((err) => {
  console.error("Error:", err.response?.data || err.message);
  process.exit(1);
});
