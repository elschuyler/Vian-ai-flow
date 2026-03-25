// ghost.js - The connection from Vian to Cloudflare
export async function fetchFromGhostNetwork(prompt) {
  // Replace this with your actual Cloudflare Worker URL from Phase 2
  const WORKER_URL = "https://supreme-agent-director.YOURUSERNAME.workers.dev";

  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt: prompt })
    });

    if (!response.ok) {
      throw new Error(`Ghost Network Error: ${response.status}`);
    }

    const data = await response.json();
    return data.response;

  } catch (error) {
    console.error("Ghost Network Connection Failed:", error);
    return "Error connecting to Supreme Agent.";
  }
}
