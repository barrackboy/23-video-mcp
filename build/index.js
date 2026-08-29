"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
// 1. Retrieve environment variables
const TWENTYTHREE_DOMAIN = process.env.TWENTYTHREE_DOMAIN;
const CONSUMER_KEY = process.env.TWENTYTHREE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.TWENTYTHREE_CONSUMER_SECRET;
const ACCESS_TOKEN = process.env.TWENTYTHREE_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.TWENTYTHREE_ACCESS_TOKEN_SECRET;
if (!TWENTYTHREE_DOMAIN ||
    !CONSUMER_KEY ||
    !CONSUMER_SECRET ||
    !ACCESS_TOKEN ||
    !ACCESS_TOKEN_SECRET) {
    console.error("Error: TWENTYTHREE_DOMAIN, TWENTYTHREE_CONSUMER_KEY, TWENTYTHREE_CONSUMER_SECRET, " +
        "TWENTYTHREE_ACCESS_TOKEN, and TWENTYTHREE_ACCESS_TOKEN_SECRET environment variables are required.");
    process.exit(1);
}
// 2. OAuth 1.0a helpers (RFC 5849, HMAC-SHA1) — implemented with Node's built-in
//    crypto module only, so no extra dependency is required.
function percentEncode(str) {
    return encodeURIComponent(str).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function generateNonce() {
    return crypto_1.default.randomBytes(16).toString("hex");
}
/**
 * Builds a fully OAuth 1.0a-signed URL (query-string based) for a request.
 * `extraParams` are the request's own params (e.g. search, size, photo_id, format).
 * Works for both GET and POST — TwentyThree's API (like other OAuth 1.0a APIs of
 * its era, e.g. Flickr) signs and accepts all params via the query string
 * regardless of HTTP verb, so POST calls are issued with an empty body and every
 * param on the URL.
 */
function buildSignedUrl(method, baseUrl, extraParams) {
    const oauthParams = {
        oauth_consumer_key: CONSUMER_KEY,
        oauth_nonce: generateNonce(),
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_token: ACCESS_TOKEN,
        oauth_version: "1.0",
    };
    const allParams = { ...extraParams, ...oauthParams };
    // Build the normalized parameter string (sorted by key, RFC 3986 percent-encoded).
    const paramString = Object.keys(allParams)
        .sort()
        .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
        .join("&");
    const baseString = [
        method.toUpperCase(),
        percentEncode(baseUrl),
        percentEncode(paramString),
    ].join("&");
    const signingKey = `${percentEncode(CONSUMER_SECRET)}&${percentEncode(ACCESS_TOKEN_SECRET)}`;
    const signature = crypto_1.default
        .createHmac("sha1", signingKey)
        .update(baseString)
        .digest("base64");
    const finalParams = { ...allParams, oauth_signature: signature };
    const queryString = Object.keys(finalParams)
        .sort()
        .map((key) => `${percentEncode(key)}=${percentEncode(finalParams[key])}`)
        .join("&");
    return `${baseUrl}?${queryString}`;
}
/**
 * Signs and issues a call against a TwentyThree API method, returning the raw
 * axios response. Centralizes the "sign as query string, dispatch with the
 * right verb" logic so individual tools stay short.
 */
async function callTwentyThreeApi(httpMethod, path, params) {
    const baseUrl = `https://${TWENTYTHREE_DOMAIN}${path}`;
    const signedUrl = buildSignedUrl(httpMethod, baseUrl, { format: "json", ...params });
    return httpMethod === "GET" ? axios_1.default.get(signedUrl) : axios_1.default.post(signedUrl);
}
function formatApiError(error, action) {
    const detail = error.response
        ? `status ${error.response.status}: ${JSON.stringify(error.response.data)}`
        : error.message;
    return `API Error ${action}: ${detail}`;
}
// 3. Initialize the modern McpServer instance
const server = new mcp_js_1.McpServer({
    name: "twentythree-video-mcp",
    version: "3.1.0",
});
// 4. Register the Video Search Tool using Zod schemas
server.tool("search_videos", "Search for videos on the TwentyThree platform by keyword or tag.", {
    search: zod_1.z.string().describe("The query to search video titles and descriptions."),
    limit: zod_1.z.number().optional().default(5).describe("Number of videos to return"),
}, async ({ search, limit }) => {
    try {
        const response = await callTwentyThreeApi("GET", "/api/2/photo/list", {
            search,
            size: String(limit),
        });
        return {
            content: [{ type: "text", text: JSON.stringify(response.data) }],
        };
    }
    catch (error) {
        return {
            isError: true,
            content: [{ type: "text", text: formatApiError(error, "searching videos") }],
        };
    }
});
// 5. Register the Get Transcript Tool
server.tool("get_video_transcript", "Retrieve the text transcript for a specific TwentyThree video ID.", {
    photo_id: zod_1.z.string().describe("The unique ID of the video/photo asset."),
}, async ({ photo_id }) => {
    try {
        const response = await callTwentyThreeApi("GET", "/api/photo/get", { photo_id });
        const transcript = response.data?.photo?.transcript || "No text transcript available for this video ID.";
        return {
            content: [{ type: "text", text: transcript }],
        };
    }
    catch (error) {
        return {
            isError: true,
            content: [{ type: "text", text: formatApiError(error, "fetching transcript") }],
        };
    }
});
// 6. Update a video's metadata (title, description, tags, channel, published state)
server.tool("update_video", "Update metadata on a TwentyThree video: title, description, tags, channel/album, or published state.", {
    photo_id: zod_1.z.string().describe("The unique ID of the video/photo asset to update."),
    title: zod_1.z.string().optional().describe("New title. HTML tags are stripped."),
    description: zod_1.z
        .string()
        .optional()
        .describe("New description. A few safe HTML tags (e.g. <b>, <p>) are allowed."),
    tags: zod_1.z
        .string()
        .optional()
        .describe("Space-separated list of tags. Overwrites all existing tags."),
    album_id: zod_1.z
        .string()
        .optional()
        .describe("Channel/album ID to file the video under. Comma-separated for multiple."),
    published: zod_1.z
        .boolean()
        .optional()
        .describe("Whether the video should be published (true) or unpublished (false)."),
}, async ({ photo_id, title, description, tags, album_id, published }) => {
    try {
        const params = { photo_id };
        if (title !== undefined)
            params.title = title;
        if (description !== undefined)
            params.description = description;
        if (tags !== undefined)
            params.tags = tags;
        if (album_id !== undefined)
            params.album_id = album_id;
        if (published !== undefined)
            params.published_p = published ? "1" : "0";
        const response = await callTwentyThreeApi("POST", "/api/photo/update", params);
        return {
            content: [{ type: "text", text: JSON.stringify(response.data) }],
        };
    }
    catch (error) {
        return {
            isError: true,
            content: [{ type: "text", text: formatApiError(error, "updating video") }],
        };
    }
});
// 7. List channels/albums videos are organized into
server.tool("list_channels", "List the channels (albums) that videos on the TwentyThree site are organized into.", {
    search: zod_1.z.string().optional().describe("Filter channels/albums by title."),
    limit: zod_1.z.number().optional().default(20).describe("Number of channels to return"),
    page: zod_1.z.number().optional().describe("Pagination offset (0-based)."),
}, async ({ search, limit, page }) => {
    try {
        const params = { size: String(limit) };
        if (search !== undefined)
            params.search = search;
        if (page !== undefined)
            params.p = String(page);
        const response = await callTwentyThreeApi("GET", "/api/album/list", params);
        return {
            content: [{ type: "text", text: JSON.stringify(response.data) }],
        };
    }
    catch (error) {
        return {
            isError: true,
            content: [{ type: "text", text: formatApiError(error, "listing channels") }],
        };
    }
});
// 8. Check a video's transcoding/processing progress
server.tool("check_video_processing_status", "Check how far along a newly-uploaded TwentyThree video is in transcoding, per output format.", {
    photo_id: zod_1.z.string().describe("The unique ID of the video/photo asset."),
}, async ({ photo_id }) => {
    try {
        const response = await callTwentyThreeApi("POST", "/api/photo/get-transcoding-progress", { photo_id, percentage_formated_p: "1" });
        return {
            content: [{ type: "text", text: JSON.stringify(response.data) }],
        };
    }
    catch (error) {
        return {
            isError: true,
            content: [{ type: "text", text: formatApiError(error, "checking processing status") }],
        };
    }
});
// 9. Get play analytics for one or more videos
server.tool("get_video_analytics", "Get play analytics (plays, finishes, engagement, downloads) for one or more TwentyThree videos over a date range.", {
    date_start: zod_1.z.string().describe("Start date of the range, e.g. 2026-01-01."),
    date_end: zod_1.z.string().describe("End date of the range, e.g. 2026-01-31."),
    photo_id: zod_1.z
        .string()
        .optional()
        .describe("Comma-separated video/photo IDs. Omit to get site-wide stats."),
    order_by: zod_1.z
        .enum(["downloads", "playthrough_average", "engagement", "embeds"])
        .optional()
        .default("downloads")
        .describe("Field to sort results by."),
    order: zod_1.z.enum(["asc", "desc"]).optional().default("desc").describe("Sort direction."),
    limit: zod_1.z.number().optional().describe("Number of results per page."),
}, async ({ date_start, date_end, photo_id, order_by, order, limit }) => {
    try {
        const params = {
            date_start,
            date_end,
            orderby: order_by ?? "downloads",
            order: order ?? "desc",
        };
        if (photo_id !== undefined)
            params.photo_id = photo_id;
        if (limit !== undefined)
            params.size = String(limit);
        const response = await callTwentyThreeApi("GET", "/api/analytics/extract/play-details", params);
        return {
            content: [{ type: "text", text: JSON.stringify(response.data) }],
        };
    }
    catch (error) {
        return {
            isError: true,
            content: [{ type: "text", text: formatApiError(error, "fetching video analytics") }],
        };
    }
});
// 10. Site-wide search across videos, channels, and live streams
server.tool("search_site", "Search across the whole TwentyThree site — videos, channels/albums, and live streams — not just videos.", {
    search: zod_1.z.string().describe("The search string."),
    search_in: zod_1.z
        .string()
        .optional()
        .describe('Space-separated object types to search: "photos", "albums", "live". Defaults to photos and albums.'),
    limit: zod_1.z
        .number()
        .optional()
        .default(10)
        .describe("Max results to return (site max is 30, no pagination)."),
    partial_match: zod_1.z
        .boolean()
        .optional()
        .describe("Include partial text matches in results."),
}, async ({ search, search_in, limit, partial_match }) => {
    try {
        const params = { search, size: String(limit) };
        if (search_in !== undefined)
            params.search_in = search_in;
        if (partial_match !== undefined)
            params.partial_search_p = partial_match ? "1" : "0";
        const response = await callTwentyThreeApi("GET", "/api/site/search", params);
        return {
            content: [{ type: "text", text: JSON.stringify(response.data) }],
        };
    } 
    catch (error) {
        return {
            isError: true,
            content: [{ type: "text", text: formatApiError(error, "searching the site") }],
        };
    }
});
// 11. Start the server using Standard Input/Output (stdio) transport
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error("TwentyThree MCP Server (OAuth 1.0a) running on Stdio...");
}
main().catch((error) => {
    console.error("Fatal server error:", error);
    process.exit(1);
});
