const API_BASE = "https://api.github.com";

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;

async function githubRequest(path, options = {}) {
  if (!OWNER || !REPO || !TOKEN) {
    throw new Error("GitHub storage environment variables are missing");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "GitHub storage request failed");
  }

  return data;
}

async function readJSON(filePath, fallback = {}) {
  try {
    const file = await githubRequest(
      `/repos/${OWNER}/${REPO}/contents/${filePath}`
    );

    const content = Buffer.from(file.content, "base64").toString("utf8");

    return {
      data: JSON.parse(content),
      sha: file.sha
    };
  } catch (error) {
    if (error.message.includes("Not Found")) {
      return {
        data: fallback,
        sha: null
      };
    }

    throw error;
  }
}

async function writeJSON(filePath, data, sha = null) {
  const content = Buffer.from(
    JSON.stringify(data, null, 2)
  ).toString("base64");

  return githubRequest(
    `/repos/${OWNER}/${REPO}/contents/${filePath}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Update ${filePath}`,
        content,
        ...(sha ? { sha } : {})
      })
    }
  );
}

module.exports = {
  readJSON,
  writeJSON
};
