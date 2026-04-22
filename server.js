const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const session = require("express-session");
const XLSX = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-productivity-mvp-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);
app.use(express.static(path.join(__dirname, "public")));

const usersFilePath = path.join(__dirname, "users.json");

function loadUsers() {
  if (!fs.existsSync(usersFilePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(usersFilePath, "utf-8");
    return JSON.parse(raw || "[]");
  } catch (_) {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hashed = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hashed}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hashed] = String(storedHash || "").split(":");
  if (!salt || !hashed) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hashed, "hex"), Buffer.from(candidate, "hex"));
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

const workbookPath = path.join(
  __dirname,
  "intern_assignment_support_pack_dev_only_v3.xlsx"
);

const workbook = XLSX.readFile(workbookPath);

const sheetToJson = (name) =>
  XLSX.utils.sheet_to_json(workbook.Sheets[name], {
    raw: true,
    defval: null,
  });

const developers = sheetToJson("Dim_Developers");
const jiraIssues = sheetToJson("Fact_Jira_Issues");
const pullRequests = sheetToJson("Fact_Pull_Requests");
const deployments = sheetToJson("Fact_CI_Deployments");
const bugReports = sheetToJson("Fact_Bug_Reports");

const mean = (values) =>
  values.length ? values.reduce((sum, val) => sum + Number(val), 0) / values.length : 0;

const round2 = (value) => Math.round(value * 100) / 100;

const allMonths = Array.from(
  new Set(
    [
      ...jiraIssues.map((x) => x.month_done),
      ...pullRequests.map((x) => x.month_merged),
      ...deployments.map((x) => x.month_deployed),
      ...bugReports.map((x) => x.month_found),
    ].filter(Boolean)
  )
).sort();

const latestMonth = allMonths[allMonths.length - 1];
const previousMonth = allMonths[allMonths.length - 2] || null;

function getMetricsForDeveloper(developerId, month) {
  const issueRows = jiraIssues.filter(
    (x) => x.developer_id === developerId && x.status === "Done" && x.month_done === month
  );
  const prRows = pullRequests.filter(
    (x) =>
      x.developer_id === developerId &&
      String(x.status || "").toLowerCase() === "merged" &&
      x.month_merged === month
  );
  const deployRows = deployments.filter(
    (x) =>
      x.developer_id === developerId &&
      x.environment === "prod" &&
      String(x.status || "").toLowerCase() === "success" &&
      x.month_deployed === month
  );
  const escapedBugRows = bugReports.filter(
    (x) =>
      x.developer_id === developerId &&
      x.month_found === month &&
      String(x.escaped_to_prod || "").toLowerCase() === "yes"
  );

  const metrics = {
    leadTimeDays: round2(mean(deployRows.map((x) => Number(x.lead_time_days) || 0))),
    cycleTimeDays: round2(mean(issueRows.map((x) => Number(x.cycle_time_days) || 0))),
    bugRate: issueRows.length ? round2(escapedBugRows.length / issueRows.length) : 0,
    deploymentFrequency: deployRows.length,
    prThroughput: prRows.length,
  };

  return {
    month,
    developerId,
    dataPoints: {
      completedIssues: issueRows.length,
      escapedBugs: escapedBugRows.length,
      mergedPrs: prRows.length,
      successfulProdDeployments: deployRows.length,
    },
    metrics,
  };
}

function delta(current, previous) {
  if (previous === null || previous === undefined) return null;
  return round2(current - previous);
}

function getInterpretation(currentMetrics, prevMetrics, peerMetrics) {
  const notes = [];
  const actions = [];

  const leadDelta = delta(currentMetrics.leadTimeDays, prevMetrics?.leadTimeDays);
  const cycleDelta = delta(currentMetrics.cycleTimeDays, prevMetrics?.cycleTimeDays);
  const bugDelta = delta(currentMetrics.bugRate, prevMetrics?.bugRate);
  const deployDelta = delta(
    currentMetrics.deploymentFrequency,
    prevMetrics?.deploymentFrequency
  );
  const prDelta = delta(currentMetrics.prThroughput, prevMetrics?.prThroughput);

  if (currentMetrics.leadTimeDays > peerMetrics.leadTimeDays * 1.15) {
    notes.push("Lead time is slower than peer average, indicating delivery drag after PR open.");
    actions.push("Reduce PR batch size and target review-ready changes under ~300 lines.");
  }
  if (currentMetrics.cycleTimeDays > peerMetrics.cycleTimeDays * 1.15) {
    notes.push("Cycle time is above peer average, suggesting planning or execution bottlenecks.");
    actions.push("Split work into smaller issues and set explicit 'definition of done' before coding.");
  }
  if (currentMetrics.bugRate > peerMetrics.bugRate * 1.2 && currentMetrics.bugRate > 0) {
    notes.push("Bug rate is elevated versus peers, implying quality leakage to production.");
    actions.push("Add one focused test case for the riskiest code path before every merge.");
  }
  if (currentMetrics.deploymentFrequency < peerMetrics.deploymentFrequency * 0.85) {
    notes.push("Deployment frequency is lower than peers, which can hide unfinished value.");
    actions.push("Adopt a small weekly release cadence with release checklist automation.");
  }
  if (currentMetrics.prThroughput < peerMetrics.prThroughput * 0.85) {
    notes.push("PR throughput trails peers, likely from larger PRs or review delays.");
    actions.push("Timebox review requests and open early draft PRs for asynchronous feedback.");
  }

  if (!notes.length) {
    notes.push("Your current metrics are close to peer baseline, with no major delivery risk signal.");
    actions.push("Keep your current cadence and run a weekly retrospective on one metric trend.");
  }

  return {
    notes: notes.slice(0, 3),
    recommendedActions: Array.from(new Set(actions)).slice(0, 2),
    trend: {
      leadTimeDays: leadDelta,
      cycleTimeDays: cycleDelta,
      bugRate: bugDelta,
      deploymentFrequency: deployDelta,
      prThroughput: prDelta,
    },
  };
}

function getPeerMetrics(month) {
  const perDev = developers.map((dev) => getMetricsForDeveloper(dev.developer_id, month).metrics);
  return {
    leadTimeDays: round2(mean(perDev.map((m) => m.leadTimeDays))),
    cycleTimeDays: round2(mean(perDev.map((m) => m.cycleTimeDays))),
    bugRate: round2(mean(perDev.map((m) => m.bugRate))),
    deploymentFrequency: round2(mean(perDev.map((m) => m.deploymentFrequency))),
    prThroughput: round2(mean(perDev.map((m) => m.prThroughput))),
  };
}

app.get("/api/auth/me", (req, res) => {
  const users = loadUsers();
  const current = users.find((u) => u.id === req.session.userId);
  if (!current) {
    return res.json({ authenticated: false });
  }
  return res.json({ authenticated: true, user: publicUser(current) });
});

app.post("/api/auth/signup", (req, res) => {
  const { name, email, password } = req.body || {};
  const cleanedName = String(name || "").trim();
  const cleanedEmail = String(email || "").trim().toLowerCase();
  const cleanedPassword = String(password || "");

  if (!cleanedName || !cleanedEmail || !cleanedPassword) {
    return res.status(400).json({ error: "Name, email, and password are required." });
  }
  if (cleanedPassword.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const users = loadUsers();
  const existing = users.find((u) => u.email === cleanedEmail);
  if (existing) {
    if (verifyPassword(cleanedPassword, existing.passwordHash)) {
      req.session.userId = existing.id;
      return res.status(200).json({
        user: publicUser(existing),
        message: "Account already exists. Signed in with existing account.",
      });
    }
    return res.status(409).json({ error: "Email already registered. Please login instead." });
  }

  const user = {
    id: crypto.randomUUID(),
    name: cleanedName,
    email: cleanedEmail,
    passwordHash: hashPassword(cleanedPassword),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  req.session.userId = user.id;

  return res.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const users = loadUsers();
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = users.find((u) => u.email === normalizedEmail);
  if (!user || !verifyPassword(String(password), user.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  req.session.userId = user.id;
  return res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    return res.json({ ok: true });
  });
});

app.get("/api/overview", requireAuth, (_, res) => {
  res.json({
    months: allMonths,
    defaultMonth: latestMonth,
    previousMonth,
    developers,
  });
});

app.get("/api/ic/:developerId", requireAuth, (req, res) => {
  const { developerId } = req.params;
  const month = req.query.month || latestMonth;
  const dev = developers.find((x) => x.developer_id === developerId);

  if (!dev) {
    return res.status(404).json({ error: "Developer not found" });
  }

  const current = getMetricsForDeveloper(developerId, month);
  const prev = previousMonth ? getMetricsForDeveloper(developerId, previousMonth) : null;
  const peer = getPeerMetrics(month);
  const interpretation = getInterpretation(current.metrics, prev?.metrics, peer);

  return res.json({
    profile: dev,
    current,
    previous: prev,
    peerBaseline: peer,
    interpretation,
  });
});

app.get("/api/manager-summary", requireAuth, (req, res) => {
  const month = req.query.month || latestMonth;
  const byTeam = {};

  for (const dev of developers) {
    const team = dev.team_name || "Unknown Team";
    const metrics = getMetricsForDeveloper(dev.developer_id, month).metrics;
    if (!byTeam[team]) {
      byTeam[team] = [];
    }
    byTeam[team].push(metrics);
  }

  const teamSummary = Object.entries(byTeam).map(([team, rows]) => ({
    team,
    leadTimeDays: round2(mean(rows.map((x) => x.leadTimeDays))),
    cycleTimeDays: round2(mean(rows.map((x) => x.cycleTimeDays))),
    bugRate: round2(mean(rows.map((x) => x.bugRate))),
    deploymentFrequency: round2(mean(rows.map((x) => x.deploymentFrequency))),
    prThroughput: round2(mean(rows.map((x) => x.prThroughput))),
  }));

  res.json({ month, teamSummary });
});

app.listen(PORT, () => {
  console.log(`Developer productivity MVP running on http://localhost:${PORT}`);
});
