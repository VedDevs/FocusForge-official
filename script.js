import { firebaseConfig, USERS, USER_IDS, REWARD_ICONS } from "./Config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  addDoc,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Init ─────────────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ─── State ────────────────────────────────────────────────────────────────────
let userData        = {};
let allTransactions = [];
let historyFilter   = "all";
let storeUser       = USER_IDS[0] || "vedant";

// Initialize empty user state structures dynamically based on keys
USER_IDS.forEach(id => { userData[id] = {}; });

// ─── Setup UI Components Dynamically ──────────────────────────────────────────
function initDynamicUI() {
  // 1. Setup Dashboard Cards Containers
  const cardsGrid = document.getElementById("dashboard-cards-grid");
  cardsGrid.innerHTML = USER_IDS.map((id, index) => `
    <div class="user-card" id="card-${id}" style="border-top: 3px solid ${USERS[id].color}">
      <div class="user-avatar" style="background: ${USERS[id].color}24; color: ${USERS[id].color}">${index + 1}</div>
      <div class="user-info">
        <div class="user-name">${USERS[id].name}</div>
        <div class="user-pts-label">TOTAL POINTS</div>
        <div class="user-pts" id="${id}-points" style="color: ${USERS[id].color}">—</div>
        <div class="user-meta">
          <span>Claims today: <strong id="${id}-daily">—</strong></span>
          <span>Last: <strong id="${id}-last">—</strong></span>
        </div>
      </div>
      <div class="card-glow" style="background: ${USERS[id].color}"></div>
    </div>
  `).join("");

  // 2. Setup Store Selector Buttons
  const selectorBar = document.getElementById("user-select-buttons");
  selectorBar.innerHTML = USER_IDS.map(id => `
    <button class="user-sel ${id === storeUser ? 'active' : ''}" data-user="${id}">${USERS[id].name}</button>
  `).join("");

  // Attach dynamic user selection logic listeners
  document.querySelectorAll(".user-sel").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".user-sel").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      storeUser = btn.dataset.user;
      updateStoreBalance();
    });
  });
}

// ─── Navigation & Interaction Listeners ───────────────────────────────────────
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("page-" + btn.dataset.page).classList.add("active");
  });
});

document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    historyFilter = btn.dataset.filter;
    renderHistory();
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function updateStoreBalance() {
  const pts = userData[storeUser]?.points ?? "—";
  document.getElementById("store-balance").textContent = pts;
}

function fmtTs(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
}

function showToast(msg, type = "ok") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast " + type + " show";
  setTimeout(() => { t.classList.remove("show"); }, 3000);
}

// ─── Realtime Streams ────────────────────────────────────────────────────────
function initRealtimeStreams() {
  // Listen for all users safely loops
  USER_IDS.forEach(user => {
    const ref = doc(db, "users", user);
    onSnapshot(ref, snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      userData[user] = d;

      // Update UI components
      const ptsEl = document.getElementById(user + "-points");
      const dailyEl = document.getElementById(user + "-daily");
      const lastEl = document.getElementById(user + "-last");

      if (ptsEl) ptsEl.textContent = d.points ?? 0;
      if (dailyEl) dailyEl.textContent = d.dailyClaims ?? 0;
      
      if (lastEl) {
        const lastTs = d.lastClaim;
        lastEl.textContent = lastTs ? (lastTs.toDate ? lastTs.toDate().toLocaleTimeString("en-IN") : lastTs) : "Never";
      }

      updateStoreBalance();
      renderLeaderboard();
    });
  });

  // Transaction Pipeline Feed 
  const txQuery = query(collection(db, "transactions"), orderBy("timestamp", "desc"), limit(50));
  onSnapshot(txQuery, snap => {
    allTransactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHistory();
    renderLiveFeed();
  });

  // Rewards Store Pipeline
  onSnapshot(collection(db, "rewards"), snap => {
    const rewards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRewards(rewards);
  });
}

// ─── Renders ──────────────────────────────────────────────────────────────────
function renderRewards(rewards) {
  const grid = document.getElementById("rewards-grid");
  if (rewards.length === 0) {
    grid.innerHTML = `<div class="loading-ph">No rewards available yet.</div>`;
    return;
  }
  grid.innerHTML = rewards.map((r, i) => {
    const icon = REWARD_ICONS[i % REWARD_ICONS.length];
    const noStock = r.stock <= 0;
    return `
      <div class="reward-card ${noStock ? 'no-stock' : ''}">
        <div class="reward-icon">${icon}</div>
        <div class="reward-name">${r.name}</div>
        <div class="reward-cost">⚡ ${r.cost} pts</div>
        <div class="reward-stock">${noStock ? 'Out of stock' : r.stock + ' remaining'}</div>
        <button class="redeem-btn"
          data-id="${r.id}" data-cost="${r.cost}" data-name="${r.name}"
          ${noStock ? 'disabled' : ''}>
          ${noStock ? 'Unavailable' : 'Redeem'}
        </button>
      </div>`;
  }).join("");

  grid.querySelectorAll(".redeem-btn:not(:disabled)").forEach(btn => {
    btn.addEventListener("click", () => redeemReward(
      btn.dataset.id,
      parseInt(btn.dataset.cost),
      btn.dataset.name
    ));
  });
}

async function redeemReward(rewardId, cost, rewardName) {
  const userPts = userData[storeUser]?.points ?? 0;
  if (userPts < cost) {
    showToast(`Not enough points! Need ${cost}, have ${userPts}`, "err");
    return;
  }

  try {
    const userRef   = doc(db, "users", storeUser);
    const rewardRef = doc(db, "rewards", rewardId);

    await runTransaction(db, async (tx) => {
      const userSnap   = await tx.get(userRef);
      const rewardSnap = await tx.get(rewardRef);

      if (!userSnap.exists() || !rewardSnap.exists()) throw new Error("Data missing");

      const currentPts  = userSnap.data().points || 0;
      const currentStock = rewardSnap.data().stock || 0;

      if (currentPts < cost)     throw new Error("Insufficient points");
      if (currentStock <= 0)     throw new Error("Out of stock");

      tx.update(userRef, { points: currentPts - cost });
      tx.update(rewardRef, { stock: currentStock - 1 });
    });

    await addDoc(collection(db, "transactions"), {
      user:      storeUser,
      type:      "spend",
      points:    cost,
      reward:    rewardName,
      timestamp: serverTimestamp()
    });

    showToast(`🎉 Redeemed ${rewardName} for ${cost} pts!`, "ok");
  } catch (err) {
    showToast("Failed: " + err.message, "err");
    console.error(err);
  }
}

function renderLeaderboard() {
  const users = USER_IDS.map(id => ({
    id,
    name: USERS[id]?.name || id,
    color: USERS[id]?.color || "var(--accent)",
    ...userData[id]
  })).sort((a, b) => (b.points || 0) - (a.points || 0));

  const maxPts = Math.max(...users.map(u => u.points || 0), 1);
  const container = document.getElementById("lb-container");

  container.innerHTML = users.map((u, i) => {
    const fillPct = Math.round(((u.points || 0) / maxPts) * 100);
    return `
      <div class="lb-card rank-${i+1}" style="${i === 0 ? `border-color: ${u.color}` : ''}">
        <div class="lb-rank" style="${i === 0 ? `color: ${u.color}` : ''}">${i+1}</div>
        <div class="lb-avatar" style="background:${u.color}24; color:${u.color}">
          ${u.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <div class="lb-name">${u.name}</div>
          <div class="lb-sub">${u.dailyClaims ?? 0} claims today</div>
        </div>
        <div class="lb-pts" style="color:${u.color}">${u.points ?? 0}</div>
        <div class="lb-bar-track">
          <div class="lb-bar-fill" style="width:${fillPct}%;background:${u.color}"></div>
        </div>
      </div>`;
  }).join("");
}

function renderHistory() {
  const filtered = historyFilter === "all"
    ? allTransactions
    : allTransactions.filter(t => t.type === historyFilter);

  const list = document.getElementById("history-list");
  if (filtered.length === 0) {
    list.innerHTML = `<div class="loading-ph">No transactions found.</div>`;
    return;
  }

  list.innerHTML = filtered.map(tx => {
    const sign   = tx.type === "earn" ? "+" : "-";
    const label  = tx.type === "earn" ? "EARNED" : "SPENT";
    const detail = tx.reward ? ` · ${tx.reward}` : "";
    const userConfig = USERS[tx.user];
    const displayName = userConfig ? userConfig.name : (tx.user ? tx.user.toUpperCase() : "System");
    
    return `
      <div class="tx-item tx-${tx.type}">
        <div class="tx-type-badge">${label}</div>
        <div>
          <div class="tx-user">${displayName}</div>
          <div class="tx-ts">${fmtTs(tx.timestamp)}${detail}</div>
        </div>
        <div class="tx-pts">${sign}${tx.points}</div>
      </div>`;
  }).join("");
}

function renderLiveFeed() {
  const feedList = document.getElementById("live-feed-list");
  const recent   = allTransactions.slice(0, 8);

  if (recent.length === 0) {
    feedList.innerHTML = `<div class="feed-empty">No activity yet...</div>`;
    return;
  }

  feedList.innerHTML = recent.map(tx => {
    const sign  = tx.type === "earn" ? "+" : "-";
    const label = tx.type === "earn" ? "EARN" : "SPEND";
    const detail = tx.reward ? " · " + tx.reward : "";
    const userConfig = USERS[tx.user];
    const displayName = userConfig ? userConfig.name : (tx.user ? tx.user.toUpperCase() : "System");

    return `
      <div class="feed-item">
        <span class="feed-badge ${tx.type}">${label}</span>
        <span class="feed-user">${displayName}${detail}</span>
        <span class="feed-pts">${sign}${tx.points} pts</span>
      </div>`;
  }).join("");
}

// ─── Entry Execution ──────────────────────────────────────────────────────────
initDynamicUI();
initRealtimeStreams();