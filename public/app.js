const { useEffect, useMemo, useState } = React;
const API_BASE =
  window.location.port && window.location.port !== "3000" ? "http://localhost:3000" : "";

function fmt(value, suffix = "") {
  return `${Number(value || 0).toFixed(2)}${suffix}`;
}

function Delta({ value, invert = false }) {
  if (value === null || value === undefined) {
    return <span className="delta neutral">n/a</span>;
  }
  const positive = value > 0;
  const cls = value === 0 ? "neutral" : positive !== invert ? "bad" : "good";
  const sign = value > 0 ? "+" : "";
  return <span className={`delta ${cls}`}>{`${sign}${value.toFixed(2)}`}</span>;
}

function MetricCard({ label, value, delta, invertDelta = false, unit = "" }) {
  return (
    <div className="metric-card">
      <p className="metric-label">{label}</p>
      <h3 className="metric-value">{fmt(value, unit)}</h3>
      <p className="metric-sub">
        vs previous month <Delta value={delta} invert={invertDelta} />
      </p>
    </div>
  );
}

async function apiFetch(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function AuthScreen({ mode, onModeChange, onSubmit, loading, error }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      password,
    });
  };

  return (
    <main className="container auth-container">
      <section className="auth-card">
        <h1>Developer Productivity MVP</h1>
        <p className="auth-subtitle">Sign in to view IC and Manager insights.</p>

        <div className="auth-tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => onModeChange("login")}
            type="button"
          >
            Login
          </button>
          <button
            className={mode === "signup" ? "active" : ""}
            onClick={() => onModeChange("signup")}
            type="button"
          >
            Sign Up
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && (
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              minLength={6}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
          </button>
        </form>
      </section>
    </main>
  );
}

function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [user, setUser] = useState(null);
  const [overview, setOverview] = useState(null);
  const [selectedDev, setSelectedDev] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [view, setView] = useState("ic");
  const [icData, setIcData] = useState(null);
  const [managerData, setManagerData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/auth/me")
      .then((data) => {
        if (data.authenticated) {
          setUser(data.user);
        }
      })
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    apiFetch("/api/overview")
      .then((data) => {
        setOverview(data);
        setSelectedMonth(data.defaultMonth);
        if (data.developers?.length) {
          setSelectedDev(data.developers[0].developer_id);
        }
      })
      .catch((err) => setError(err.message || "Failed to load overview data."));
  }, [user]);

  useEffect(() => {
    if (!selectedDev || !selectedMonth || view !== "ic") return;
    apiFetch(`/api/ic/${selectedDev}?month=${selectedMonth}`)
      .then(setIcData)
      .catch((err) => {
        if (err.message === "Unauthorized") {
          setUser(null);
          setOverview(null);
        }
        setError(err.message || "Failed to load IC view.");
      });
  }, [selectedDev, selectedMonth, view]);

  useEffect(() => {
    if (!selectedMonth || view !== "manager") return;
    apiFetch(`/api/manager-summary?month=${selectedMonth}`)
      .then(setManagerData)
      .catch((err) => {
        if (err.message === "Unauthorized") {
          setUser(null);
          setOverview(null);
        }
        setError(err.message || "Failed to load manager summary.");
      });
  }, [selectedMonth, view]);

  const profileTitle = useMemo(() => {
    if (!icData?.profile) return "";
    const p = icData.profile;
    return `${p.developer_name} (${p.developer_id}) - ${p.team_name}`;
  }, [icData]);

  const handleAuthSubmit = async ({ name, email, password }) => {
    setAuthError("");
    setAuthBusy(true);
    try {
      const route = authMode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const payload = authMode === "login" ? { email, password } : { name, email, password };
      const data = await apiFetch(route, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setUser(data.user);
      setOverview(null);
      setError("");
    } catch (err) {
      setAuthError(err.message || "Authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => ({}));
    setUser(null);
    setOverview(null);
    setIcData(null);
    setManagerData(null);
    setSelectedDev("");
  };

  if (authLoading) {
    return <main className="container">Checking session...</main>;
  }

  if (!user) {
    return (
      <AuthScreen
        mode={authMode}
        onModeChange={setAuthMode}
        onSubmit={handleAuthSubmit}
        loading={authBusy}
        error={authError}
      />
    );
  }

  if (!overview) {
    return <main className="container">Loading MVP...</main>;
  }

  return (
    <main className="container">
      <header className="header">
        <div>
          <h1>Developer Productivity MVP</h1>
          <p>Move from raw metrics to practical action.</p>
        </div>
        <div className="header-actions">
          <div className="toolbar">
            <button
              className={view === "ic" ? "active" : ""}
              onClick={() => setView("ic")}
            >
              IC View
            </button>
            <button
              className={view === "manager" ? "active" : ""}
              onClick={() => setView("manager")}
            >
              Manager Summary
            </button>
          </div>
          <div className="user-menu">
            <span>{user.name || user.email}</span>
            <button onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </header>

      <section className="filters">
        <label>
          Month
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            {overview.months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        {view === "ic" && (
          <label>
            Developer
            <select
              value={selectedDev}
              onChange={(e) => setSelectedDev(e.target.value)}
            >
              {overview.developers.map((d) => (
                <option key={d.developer_id} value={d.developer_id}>
                  {d.developer_name} ({d.developer_id})
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {error && <p className="error">{error}</p>}

      {view === "ic" && icData && (
        <>
          <section className="panel">
            <h2>{profileTitle}</h2>
            <p>
              Manager: {icData.profile.manager_name} | Service:{" "}
              {icData.profile.service_type} | Level: {icData.profile.level}
            </p>
          </section>

          <section className="metrics-grid">
            <MetricCard
              label="Lead Time for Changes (days)"
              value={icData.current.metrics.leadTimeDays}
              delta={icData.interpretation.trend.leadTimeDays}
              invertDelta={true}
            />
            <MetricCard
              label="Cycle Time (days)"
              value={icData.current.metrics.cycleTimeDays}
              delta={icData.interpretation.trend.cycleTimeDays}
              invertDelta={true}
            />
            <MetricCard
              label="Bug Rate"
              value={icData.current.metrics.bugRate}
              delta={icData.interpretation.trend.bugRate}
              invertDelta={true}
            />
            <MetricCard
              label="Deployment Frequency"
              value={icData.current.metrics.deploymentFrequency}
              delta={icData.interpretation.trend.deploymentFrequency}
            />
            <MetricCard
              label="PR Throughput"
              value={icData.current.metrics.prThroughput}
              delta={icData.interpretation.trend.prThroughput}
            />
          </section>

          <section className="panel split">
            <div>
              <h3>Likely Story Behind the Metrics</h3>
              <ul>
                {icData.interpretation.notes.map((n, i) => (
                  <li key={`${n}-${i}`}>{n}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Recommended Next Steps</h3>
              <ul>
                {icData.interpretation.recommendedActions.map((a, i) => (
                  <li key={`${a}-${i}`}>{a}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel">
            <h3>Metric Inputs (for transparency)</h3>
            <p>
              Completed issues: {icData.current.dataPoints.completedIssues} |
              Escaped bugs: {icData.current.dataPoints.escapedBugs} | Merged PRs:{" "}
              {icData.current.dataPoints.mergedPrs} | Successful prod deployments:{" "}
              {icData.current.dataPoints.successfulProdDeployments}
            </p>
          </section>
        </>
      )}

      {view === "manager" && managerData && (
        <section className="panel">
          <h2>Team Summary ({managerData.month})</h2>
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>Lead Time</th>
                <th>Cycle Time</th>
                <th>Bug Rate</th>
                <th>Deployments</th>
                <th>Merged PRs</th>
              </tr>
            </thead>
            <tbody>
              {managerData.teamSummary.map((row) => (
                <tr key={row.team}>
                  <td>{row.team}</td>
                  <td>{fmt(row.leadTimeDays)}</td>
                  <td>{fmt(row.cycleTimeDays)}</td>
                  <td>{fmt(row.bugRate)}</td>
                  <td>{fmt(row.deploymentFrequency)}</td>
                  <td>{fmt(row.prThroughput)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
