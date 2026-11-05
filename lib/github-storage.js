
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

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || "GitHub request failed");
    error.status = response.status;
    throw error;
  }

  return data;
}

async function readJSON(filePath, fallback = {}) {
  try {
    const file = await githubRequest(
      `/repos/${OWNER}/${REPO}/contents/${filePath}`
    );

    if (Array.isArray(file)) {
      throw new Error("Expected a file, not a directory");
    }

    const content = Buffer.from(file.content, "base64").toString("utf8");

    return {
      data: JSON.parse(content),
      sha: file.sha
    };
  } catch (error) {
    if (error.status === 404) {
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

async function writeFile(filePath, base64Content) {
  if (!base64Content) {
    throw new Error("File content is missing");
  }

  return githubRequest(
    `/repos/${OWNER}/${REPO}/contents/${filePath}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Upload ${filePath}`,
        content: base64Content
      })
    }
  );
}

// Retrieve raw file content so receipts larger than 1 MB work.
async function readFile(filePath) {
  if (!OWNER || !REPO || !TOKEN) {
    throw new Error("GitHub storage environment variables are missing");
  }

  const response = await fetch(
    `${API_BASE}/repos/${OWNER}/${REPO}/contents/${filePath}`,
    {
      method: "GET",
      headers: {
        Accept: "application/vnd.github.raw+json",
        Authorization: `Bearer ${TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store"
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));

    const error = new Error(
      errorData.message || "Unable to retrieve file from GitHub"
    );

    error.status = response.status;
    throw error;
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    content: buffer.toString("base64")
  };
}

module.exports = {
  readJSON,
  writeJSON,
  writeFile,
  readFile
};
