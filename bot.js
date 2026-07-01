require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

let botRunning = false;

const PORT = process.env.PORT || 10000;

const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const FIXER = "0x8C3206F89f903638AC74DEEdD9DDC06F0c59C532";
const AERO_PAIR = "0x5503D7B01A36B434A9Da15A742aB0649f367A0C5";

const MAX_GAS_ETH = 0.00002;
const GAS_LIMIT = 180000n;

function loadSettings() {
  return JSON.parse(fs.readFileSync("settings.json"));
}

function buildWallets() {
  const s = loadSettings();
  const walletNames = Object.keys(s.wallet_ranges);

  const envMap = {
    W1: "WALLET1_PK",
    W2: "WALLET2_PK",
    W3: "WALLET3_PK",
    W4: "WALLET4_PK",
    W5: "WALLET5_PK",
    W6: "WALLET6_PK"
  };

  console.log("=== ENV CHECK ===");
  walletNames.forEach(n => {
    const envName = envMap[n];
    console.log(`${n} → ${envName} = ${process.env[envName]}`);
  });

  const built = walletNames.map(name => {
    const [min, max] = s.wallet_ranges[name];
    const envName = envMap[name];
    const pk = process.env[envName];

    if (!pk || !pk.startsWith("0x") || pk.length !== 66) {
      console.error(`❌ Private key for ${name} (ENV: ${envName}) is invalid or missing`);
      return null;
    }

    try {
      const wallet = new ethers.Wallet(pk, provider);
      console.log(`✅ Wallet built for ${name}: ${wallet.address}`);
      return {
        name,
        min,
        max,
        pk,
        wallet,
        buys: 0,
        sells: 0,
        netFixer: 0
      };
    } catch (e) {
      console.error(`❌ Failed to build wallet for ${name}:`, e);
      return null;
    }
  }).filter(Boolean);

  console.log("Total active wallets:", built.length);
  return built;
}

let wallets = buildWallets();

function randomFixerAmount(w) {
  return Math.floor(Math.random() * (w.max - w.min + 1)) + w.min;
}

async function isGasCheapEnough() {
  const fee = await provider.getFeeData();
  const gasPrice = fee.gasPrice || fee.maxFeePerGas;

  if (!gasPrice) {
    console.log("⚠ No gasPrice from provider, skipping tx");
    return false;
  }

  const costEth = Number(ethers.formatEther(gasPrice * GAS_LIMIT));
  console.log("Gas check → price:", gasPrice.toString(), "costEth:", costEth);

  return costEth <= MAX_GAS_ETH;
}

function buildSchedule() {
  const s = loadSettings();
  const schedule = [];
  let currentTime = Date.now();

  console.log("Building schedule with:", {
    tx_per_day: s.tx_per_day,
    min_delay: s.min_delay,
    max_delay: s.max_delay
  });

  for (let i = 0; i < s.tx_per_day; i++) {
    const delayMinutes = Math.floor(Math.random() * (s.max_delay - s.min_delay + 1)) + s.min_delay;
    const delay = delayMinutes * 60 * 1000;
    currentTime += delay;
    schedule.push(currentTime);
  }

  console.log("Schedule built, first 5 entries:", schedule.slice(0, 5).map(t => new Date(t).toISOString()));
  return schedule;
}

let schedule = buildSchedule();
let pointer = 0;

function pickWalletForNextTx() {
  const candidates = wallets.filter(w => w.buys + w.sells < 8);
  if (candidates.length === 0) {
    console.log("No candidates (all wallets reached 8 tx)");
    return null;
  }

  const possible = candidates.filter(w => {
    if (w.buys === 0 && w.sells === 0) return true;
    if (w.netFixer > 0) return true;
    if (w.netFixer === 0 && w.buys < 4) return true;
    return false;
  });

  if (possible.length === 0) {
    console.log("No possible wallets based on netFixer/buys/sells");
    return null;
  }

  const chosen = possible[Math.floor(Math.random() * possible.length)];
  console.log("Wallet chosen for next tx:", chosen.name, "buys:", chosen.buys, "sells:", chosen.sells, "netFixer:", chosen.netFixer);
  return chosen;
}

function decideActionForWallet(w) {
  if (w.buys === 0 && w.sells === 0) return "BUY";
  if (w.netFixer > 0) return "SELL";
  if (w.netFixer === 0 && w.buys < 4) return "BUY";
  return null;
}

const PAIR_ABI = [
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data)"
];

async function getAmountsOutFromPair(pair, amountIn, tokenIn, tokenOut) {
  const [r0, r1] = await pair.getReserves();
  const t0 = await pair.token0();
  const t1 = await pair.token1();

  let reserveIn, reserveOut;

  if (tokenIn.toLowerCase() === t0.toLowerCase()) {
    reserveIn = r0;
    reserveOut = r1;
  } else {
    reserveIn = r1;
    reserveOut = r0;
  }

  const out = (BigInt(amountIn) * BigInt(reserveOut)) / BigInt(reserveIn);
  console.log("getAmountsOutFromPair:", {
    amountIn: amountIn.toString(),
    reserveIn: reserveIn.toString(),
    reserveOut: reserveOut.toString(),
    amountOut: out.toString()
  });
  return out;
}

async function buyFixer(wallet, amountFixer) {
  console.log("BUY start:", wallet.address, "amountFixer:", amountFixer);
  const pair = new ethers.Contract(AERO_PAIR, PAIR_ABI, wallet);

  const t0 = await pair.token0();
  const t1 = await pair.token1();
  console.log("PAIR tokens:", { t0, t1 });

  let amount0Out = 0n;
  let amount1Out = 0n;

  if (t0.toLowerCase() === FIXER.toLowerCase()) {
    amount0Out = BigInt(amountFixer);
  } else {
    amount1Out = BigInt(amountFixer);
  }

  console.log("Calling swap BUY with:", {
    amount0Out: amount0Out.toString(),
    amount1Out: amount1Out.toString(),
    to: wallet.address
  });

  const tx = await pair.swap(amount0Out, amount1Out, wallet.address, "0x", { gasLimit: GAS_LIMIT });
  console.log("BUY tx sent:", tx.hash);
  await tx.wait();
  console.log("BUY tx confirmed:", tx.hash);
}

async function sellFixer(wallet, amountFixer) {
  console.log("SELL start:", wallet.address, "amountFixer:", amountFixer);
  const pair = new ethers.Contract(AERO_PAIR, PAIR_ABI, wallet);

  const amountOutUSDC = await getAmountsOutFromPair(pair, amountFixer, FIXER, USDC);

  const t0 = await pair.token0();
  const t1 = await pair.token1();
  console.log("PAIR tokens:", { t0, t1 });

  let amount0Out = 0n;
  let amount1Out = 0n;

  if (t0.toLowerCase() === USDC.toLowerCase()) {
    amount0Out = BigInt(amountOutUSDC);
  } else {
    amount1Out = BigInt(amountOutUSDC);
  }

  console.log("Calling swap SELL with:", {
    amount0Out: amount0Out.toString(),
    amount1Out: amount1Out.toString(),
    to: wallet.address
  });

  const tx = await pair.swap(amount0Out, amount1Out, wallet.address, "0x", { gasLimit: GAS_LIMIT });
  console.log("SELL tx sent:", tx.hash);
  await tx.wait();
  console.log("SELL tx confirmed:", tx.hash);
}

setInterval(async () => {
  if (!botRunning) return;

  const now = Date.now();

  if (pointer >= schedule.length) {
    console.log("Schedule finished, rebuilding wallets & schedule...");
    wallets = buildWallets();
    schedule = buildSchedule();
    pointer = 0;
    return;
  }

  const nextTime = schedule[pointer];
  if (now < nextTime) {
    return;
  }

  console.log("Tick at", new Date(now).toISOString(), "→ pointer", pointer, "nextTime", new Date(nextTime).toISOString());

  const gasOK = await isGasCheapEnough();
  if (!gasOK) {
    console.log("Gas too high, skipping tx at", new Date(now).toISOString());
    return;
  }

  const w = pickWalletForNextTx();
  if (!w) {
    console.log("No eligible wallet for next tx");
    return;
  }

  const action = decideActionForWallet(w);
  if (!action) {
    console.log("No action decided for wallet", w.name);
    return;
  }

  let amount = randomFixerAmount(w);

  if (action === "SELL" && w.netFixer > 0) {
    if (w.sells === 3) amount = w.netFixer;
    else if (amount > w.netFixer) amount = w.netFixer;
  }

  console.log("TX planned:", {
    wallet: w.name,
    action,
    amount,
    buys: w.buys,
    sells: w.sells,
    netFixer: w.netFixer
  });

  try {
    if (action === "BUY") {
      await buyFixer(w.wallet, amount);
      w.buys++;
      w.netFixer += amount;
      console.log("BUY done for", w.name, "amount", amount, "netFixer now", w.netFixer);
    } else {
      await sellFixer(w.wallet, amount);
      w.sells++;
      w.netFixer -= amount;
      if (w.netFixer < 0) w.netFixer = 0;
      console.log("SELL done for", w.name, "amount", amount, "netFixer now", w.netFixer);
    }
  } catch (e) {
    console.error("❌ TX failed for", w.name, "action", action, "error:", e);
  }

  pointer++;

}, 20000);

// ⭐ نسخهٔ اصلاح‌شدهٔ START
app.get("/start", (req, res) => {
  console.log("/start received");

  wallets = buildWallets();
  schedule = buildSchedule();
  pointer = 0;

  botRunning = true;
  console.log("Bot Started with fresh schedule");
  res.json({ status: "started" });
});

// ⭐ نسخهٔ اصلاح‌شدهٔ SAVE
app.post("/save", (req, res) => {
  const newSettings = req.body;
  const oldSettings = JSON.parse(fs.readFileSync("settings.json"));
  const merged = { ...oldSettings, ...newSettings };
  fs.writeFileSync("settings.json", JSON.stringify(merged, null, 2));
  console.log("Settings updated:", merged);

  schedule = buildSchedule();
  pointer = 0;

  res.json({ status: "saved" });
});

app.get("/stop", (req, res) => {
  console.log("/stop received");
  botRunning = false;
  console.log("Bot Stopped");
  res.json({ status: "stopped" });
});

console.log("BOT READY → Listening on port", PORT);
app.listen(PORT);
