import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, orderBy, query } from "firebase/firestore";
import fs from "fs";
import path from "path";

const firebaseConfig = {
  apiKey: "AIzaSyAs8PJphmaQKR1eH5qQE3JuLhHdFTbelfM",
  authDomain: "respawn-e70cb.firebaseapp.com",
  projectId: "respawn-e70cb",
  storageBucket: "respawn-e70cb.firebasestorage.app",
  messagingSenderId: "686829316377",
  appId: "1:686829316377:web:05acbff850570c4ccd7d88",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

interface Session {
  id: string;
  customerName: string;
  customerPhone: string;
  gameType: string;
  gameCategory: string;
  startTime: any;
  duration: number;
  hourlyRate: number;
  baseAmount: number;
  discountApplied: number;
  finalAmount: number;
  status: string;
  paymentStatus: string;
  notes?: string;
}

async function fetchSessions(): Promise<Session[]> {
  const q = query(collection(db, "gaming_sessions"), orderBy("startTime", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      customerName: data.customerName || "Unknown",
      customerPhone: data.customerPhone || "",
      gameType: data.gameType || "Unknown",
      gameCategory: data.gameCategory || "",
      startTime: data.startTime?.toDate?.() || new Date(),
      duration: data.duration || 0,
      hourlyRate: data.hourlyRate || 0,
      baseAmount: data.baseAmount || 0,
      discountApplied: data.discountApplied || 0,
      finalAmount: data.finalAmount || 0,
      status: data.status || "unknown",
      paymentStatus: data.paymentStatus || "unknown",
      notes: data.notes || "",
    };
  });
}

function generateHTML(sessions: Session[]): string {
  const now = new Date();

  const completed = sessions.filter((s) => s.status === "completed");
  const active = sessions.filter((s) => s.status === "active");
  const booked = sessions.filter((s) => s.status === "booked");

  const totalRevenue = completed.reduce((sum, s) => sum + s.finalAmount, 0);
  const totalDiscount = completed.reduce((sum, s) => sum + s.discountApplied, 0);
  const totalMinutes = completed.reduce((sum, s) => sum + s.duration, 0);
  const avgPerSession = completed.length > 0 ? Math.round(totalRevenue / completed.length) : 0;
  const avgDuration = completed.length > 0 ? Math.round(totalMinutes / completed.length) : 0;

  const pendingRevenue = sessions
    .filter((s) => s.paymentStatus === "pending" && s.status !== "cancelled")
    .reduce((sum, s) => sum + s.finalAmount, 0);

  // Revenue by game type
  const gameMap = new Map<string, { revenue: number; sessions: number; minutes: number; discount: number }>();
  for (const s of completed) {
    const key = s.gameType;
    const e = gameMap.get(key) || { revenue: 0, sessions: 0, minutes: 0, discount: 0 };
    e.revenue += s.finalAmount;
    e.sessions += 1;
    e.minutes += s.duration;
    e.discount += s.discountApplied;
    gameMap.set(key, e);
  }
  const gameBreakdown = Array.from(gameMap.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.revenue - a.revenue);

  // Revenue by day
  const dayMap = new Map<string, { revenue: number; sessions: number; minutes: number }>();
  for (const s of completed) {
    const day = s.startTime.toISOString().split("T")[0];
    const e = dayMap.get(day) || { revenue: 0, sessions: 0, minutes: 0 };
    e.revenue += s.finalAmount;
    e.sessions += 1;
    e.minutes += s.duration;
    dayMap.set(day, e);
  }
  const dailyData = Array.from(dayMap.entries())
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Top customers
  const custMap = new Map<string, { name: string; phone: string; revenue: number; visits: number }>();
  for (const s of completed) {
    const key = s.customerPhone || s.customerName;
    const e = custMap.get(key) || { name: s.customerName, phone: s.customerPhone, revenue: 0, visits: 0 };
    e.revenue += s.finalAmount;
    e.visits += 1;
    custMap.set(key, e);
  }
  const topCustomers = Array.from(custMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Revenue by hour of day
  const hourMap = new Map<number, { revenue: number; sessions: number }>();
  for (let h = 0; h < 24; h++) hourMap.set(h, { revenue: 0, sessions: 0 });
  for (const s of completed) {
    const h = s.startTime.getHours();
    const e = hourMap.get(h)!;
    e.revenue += s.finalAmount;
    e.sessions += 1;
  }
  const hourlyData = Array.from(hourMap.entries())
    .map(([hour, stats]) => ({ hour, ...stats }))
    .sort((a, b) => a.hour - b.hour);

  const bestDay = dailyData.reduce((best, d) => (d.revenue > best.revenue ? d : best), { date: "-", revenue: 0, sessions: 0, minutes: 0 });
  const peakHour = hourlyData.reduce((best, h) => (h.sessions > best.sessions ? h : best), { hour: 0, revenue: 0, sessions: 0 });

  const palette = ["#6750A4", "#FF9800", "#4CAF50", "#2196F3", "#EF5350", "#AB47BC", "#26A69A", "#FFA726"];
  const gameColors: Record<string, string> = {};
  gameBreakdown.forEach((g, i) => { gameColors[g.name] = palette[i % palette.length]; });

  const dailyLabels = JSON.stringify(dailyData.map((d) => d.date.slice(5)));
  const dailyRevenues = JSON.stringify(dailyData.map((d) => d.revenue));
  const dailySessions = JSON.stringify(dailyData.map((d) => d.sessions));
  const hourLabels = JSON.stringify(hourlyData.filter((h) => h.hour >= 8).map((h) => `${h.hour}:00`));
  const hourRevenues = JSON.stringify(hourlyData.filter((h) => h.hour >= 8).map((h) => h.revenue));
  const hourSessions = JSON.stringify(hourlyData.filter((h) => h.hour >= 8).map((h) => h.sessions));
  const gameLabels = JSON.stringify(gameBreakdown.map((g) => g.name));
  const gameRevenues = JSON.stringify(gameBreakdown.map((g) => g.revenue));
  const gameColorArr = JSON.stringify(gameBreakdown.map((g) => gameColors[g.name]));

  const sessionRows = sessions
    .slice(0, 50)
    .map(
      (s) => `
    <tr>
      <td>${s.startTime.toLocaleDateString("en-IN")}</td>
      <td>${s.startTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
      <td>${s.customerName}</td>
      <td><span class="badge" style="background:${gameColors[s.gameType] || "#888"}">${s.gameType}</span></td>
      <td>${s.duration}m</td>
      <td>₹${s.finalAmount}</td>
      <td><span class="status-${s.status}">${s.status}</span></td>
      <td><span class="pay-${s.paymentStatus}">${s.paymentStatus}</span></td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Respawn Gaming Cafe — Revenue Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #0f0f14; color: #e0e0e0; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: #888; margin-bottom: 32px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 32px; }
  .card { background: #1a1a24; border-radius: 12px; padding: 20px; text-align: center; }
  .card .value { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
  .card .label { font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .card.purple .value { color: #6750A4; }
  .card.green .value { color: #4CAF50; }
  .card.orange .value { color: #FF9800; }
  .card.red .value { color: #EF5350; }
  .card.blue .value { color: #2196F3; }
  .section { margin-bottom: 32px; }
  .section-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #2a2a3a; }
  .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 32px; }
  .chart-box { background: #1a1a24; border-radius: 12px; padding: 20px; }
  .chart-box h3 { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
  @media (max-width: 768px) { .chart-grid { grid-template-columns: 1fr; } }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #1f1f2f; }
  th { color: #888; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; }
  tr:hover { background: #1f1f2f; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; color: #fff; font-size: 12px; font-weight: 600; }
  .status-completed { color: #4CAF50; }
  .status-active { color: #2196F3; }
  .status-booked { color: #FF9800; }
  .status-cancelled { color: #EF5350; text-decoration: line-through; }
  .pay-paid { color: #4CAF50; }
  .pay-pending { color: #FF9800; }
  .pay-refunded { color: #EF5350; }
  .insights { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; margin-bottom: 32px; }
  .insight { background: #1a1a24; border-radius: 12px; padding: 16px; border-left: 4px solid #6750A4; }
  .insight .title { font-size: 13px; color: #888; margin-bottom: 4px; }
  .insight .detail { font-size: 15px; font-weight: 600; }
  .game-table { width: 100%; }
  .game-table td { padding: 8px 12px; }
  .footer { text-align: center; color: #555; font-size: 12px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #1f1f2f; }
</style>
</head>
<body>
<div class="container">
  <h1>Respawn Gaming Cafe</h1>
  <p class="subtitle">Revenue Report — Generated ${now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} at ${now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>

  <div class="cards">
    <div class="card purple">
      <div class="value">₹${totalRevenue.toLocaleString("en-IN")}</div>
      <div class="label">Total Revenue</div>
    </div>
    <div class="card green">
      <div class="value">${completed.length}</div>
      <div class="label">Completed Sessions</div>
    </div>
    <div class="card orange">
      <div class="value">₹${pendingRevenue.toLocaleString("en-IN")}</div>
      <div class="label">Pending Payment</div>
    </div>
    <div class="card blue">
      <div class="value">${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m</div>
      <div class="label">Total Play Time</div>
    </div>
    <div class="card purple">
      <div class="value">₹${avgPerSession}</div>
      <div class="label">Avg per Session</div>
    </div>
    <div class="card red">
      <div class="value">₹${totalDiscount.toLocaleString("en-IN")}</div>
      <div class="label">Total Discounts</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Key Insights</div>
    <div class="insights">
      <div class="insight">
        <div class="title">Best Day</div>
        <div class="detail">${bestDay.date} — ₹${bestDay.revenue} (${bestDay.sessions} sessions)</div>
      </div>
      <div class="insight">
        <div class="title">Peak Hour</div>
        <div class="detail">${peakHour.hour}:00 — ${peakHour.sessions} sessions (₹${peakHour.revenue})</div>
      </div>
      <div class="insight">
        <div class="title">Most Popular Game</div>
        <div class="detail">${gameBreakdown[0]?.name || "-"} — ${gameBreakdown[0]?.sessions || 0} sessions (₹${gameBreakdown[0]?.revenue || 0})</div>
      </div>
      <div class="insight">
        <div class="title">Avg Session Duration</div>
        <div class="detail">${avgDuration} minutes</div>
      </div>
      <div class="insight">
        <div class="title">Top Customer</div>
        <div class="detail">${topCustomers[0]?.name || "-"} — ₹${topCustomers[0]?.revenue || 0} (${topCustomers[0]?.visits || 0} visits)</div>
      </div>
      <div class="insight">
        <div class="title">Active / Booked Now</div>
        <div class="detail">${active.length} active, ${booked.length} upcoming</div>
      </div>
    </div>
  </div>

  <div class="chart-grid">
    <div class="chart-box">
      <h3>Daily Revenue</h3>
      <canvas id="dailyChart"></canvas>
    </div>
    <div class="chart-box">
      <h3>Revenue by Game Type</h3>
      <canvas id="gameChart"></canvas>
    </div>
    <div class="chart-box">
      <h3>Sessions by Hour of Day</h3>
      <canvas id="hourChart"></canvas>
    </div>
    <div class="chart-box">
      <h3>Daily Sessions Count</h3>
      <canvas id="sessionsChart"></canvas>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Game Type Breakdown</div>
    <table class="game-table">
      <tr><th>Game</th><th>Sessions</th><th>Hours</th><th>Revenue</th><th>Discounts</th><th>% of Revenue</th></tr>
      ${gameBreakdown.map((g) => `
        <tr>
          <td><span class="badge" style="background:${gameColors[g.name]}">${g.name}</span></td>
          <td>${g.sessions}</td>
          <td>${Math.round(g.minutes / 60)}h ${g.minutes % 60}m</td>
          <td>₹${g.revenue.toLocaleString("en-IN")}</td>
          <td>₹${g.discount}</td>
          <td>${totalRevenue > 0 ? Math.round((g.revenue / totalRevenue) * 100) : 0}%</td>
        </tr>`).join("")}
    </table>
  </div>

  <div class="section">
    <div class="section-title">Top Customers</div>
    <table>
      <tr><th>#</th><th>Name</th><th>Phone</th><th>Visits</th><th>Total Spent</th><th>Avg/Visit</th></tr>
      ${topCustomers.map((c, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${c.name}</td>
          <td>${c.phone}</td>
          <td>${c.visits}</td>
          <td>₹${c.revenue.toLocaleString("en-IN")}</td>
          <td>₹${Math.round(c.revenue / c.visits)}</td>
        </tr>`).join("")}
    </table>
  </div>

  <div class="section">
    <div class="section-title">Recent Sessions (last 50)</div>
    <div style="overflow-x:auto">
      <table>
        <tr><th>Date</th><th>Time</th><th>Customer</th><th>Game</th><th>Duration</th><th>Amount</th><th>Status</th><th>Payment</th></tr>
        ${sessionRows}
      </table>
    </div>
  </div>

  <div class="footer">Respawn Gaming Cafe — Auto-generated report</div>
</div>

<script>
Chart.defaults.color = '#888';
Chart.defaults.borderColor = '#2a2a3a';

new Chart(document.getElementById('dailyChart'), {
  type: 'bar',
  data: { labels: ${dailyLabels}, datasets: [{ label: 'Revenue (₹)', data: ${dailyRevenues}, backgroundColor: '#6750A4', borderRadius: 4 }] },
  options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
});

new Chart(document.getElementById('gameChart'), {
  type: 'doughnut',
  data: { labels: ${gameLabels}, datasets: [{ data: ${gameRevenues}, backgroundColor: ${gameColorArr}, borderWidth: 0 }] },
  options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
});

new Chart(document.getElementById('hourChart'), {
  type: 'bar',
  data: { labels: ${hourLabels}, datasets: [{ label: 'Sessions', data: ${hourSessions}, backgroundColor: '#FF9800', borderRadius: 4 }] },
  options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
});

new Chart(document.getElementById('sessionsChart'), {
  type: 'line',
  data: { labels: ${dailyLabels}, datasets: [{ label: 'Sessions', data: ${dailySessions}, borderColor: '#4CAF50', backgroundColor: 'rgba(76,175,80,0.1)', fill: true, tension: 0.3, pointRadius: 4 }] },
  options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
});
</script>
</body>
</html>`;
}

async function main() {
  console.log("Fetching sessions from Firestore...");
  const sessions = await fetchSessions();
  console.log(`Found ${sessions.length} sessions`);

  const html = generateHTML(sessions);
  const outPath = path.join(__dirname, "..", "report.html");
  fs.writeFileSync(outPath, html, "utf-8");
  console.log(`Report saved to ${outPath}`);

  const { exec } = require("child_process");
  const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${openCmd} "${outPath}"`);
}

main().catch(console.error);
