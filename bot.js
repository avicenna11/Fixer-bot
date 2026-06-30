require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const express = require("express");
const { botRunning } = require("./panel");

const app = express();
const PORT = process.env.PORT || 10000;

const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");

const USDC = "0x833589fCD6eDb6e08f4c7C32D4f71b54bdA02913";
const FIXER = "0x8C3206F89f903638AC74DEEdD9DDC06F0c59C532";
const AERO_PAIR = "0x5503D7B01A36B434A9Da15A742aB0649f367A0C5";

const MAX_GAS_ETH = 0.000002;
const GAS_LIMIT = 180000n;

function loadSettings() {
  return JSON.parse(fs.readFileSync("settings.json"));
}

// ⭐ نسخهٔ نهایی: مپ بین W1/W2/... و WALLET1_PK/WALLET2_PK/...
function buildWallets() {
  const s = loadSettings();

  const walletNames = Object.keys(s.wallet_ranges);

  // مپ اسم‌های settings.json → اسم‌های واقعی ENV
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
    const envName = envMap[n] || n;
    console.log(`${n} → ${envName} = ${process.env[envName]}`);
  });

  return walletNames.map(name => {
    const [min, max] = s.wallet_ranges[name];

    const envName = envMap[name] || name;
    const pk = process.env[envName];

    if (!pk || !pk.startsWith("0x") || pk.length !== 66) {
      console.error(`❌ Private key for ${name} (ENV: ${envName}) is invalid or missing`);
      return null;
    }

    return {
      name,
      min,
      max,
      pk,
      wallet: new ethers.Wallet(pk, provider),
      buys: 0,
      sells: 0,
      netFixer: 0
    };
  }).filter(Boolean);
}

let wallets = buildWallets();

function randomFixerAmount(w) {
  return Math.floor(Math.random() * (w.max - w.min + 1)) + w.min;
}

async function isGasCheapEnough() {
  const fee = await provider.getFeeData();
  const gasPrice = fee.gasPrice || fee.maxFeePerGas;
  const costEth = Number(ethers.formatEther(gasPrice * GAS_LIMIT));
  return costEth <= MAX_GAS_ETH;
}

function buildSchedule() {
  const s = loadSettings();
  const schedule = [];
  let currentTime = Date.now();

  for (let i = 0; i < s.tx_per_day; i++) {
    const delay = (Math.floor(Math.random() * (s.max_delay - s.min_delay + 1)) + s.min_delay) * 60 * 1000;
    currentTime += delay;
    schedule.push(currentTime);
  }

  return schedule;
}

let schedule = buildSchedule();
let pointer = 0;

function pickWalletForNextTx() {
  const candidates = wallets.filter(w => w.buys + w.sells < 8);
  if (candidates.length === 0) return null;

  const possible = candidates.filter(w => {
    if (w.buys === 0 && w.sells === 0) return true;
    if (w.netFixer > 0) return true;
    if (w.netFixer === 0 && w.buys < 4) return true;
    return false;
  });

  if (possible.length === 0) return null;

  return possible[Math.floor(Math.random() * possible.length)];
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

  return (BigInt(amountIn) * BigInt(reserveOut)) / BigInt(reserveIn);
}

async function buyFixer(wallet, amountFixer) {
  const pair = new ethers.Contract(AERO_PAIR, PAIR_ABI, wallet);

  const t0 = await pair.token0();
  const t1 = await pair.token1();

  let amount0Out = 0n;
  let amount1Out = 0n;

  if (t0.toLowerCase() === FIXER.toLowerCase()) {
    amount0Out = BigInt(amountFixer);
  } else {
    amount1Out = BigInt(amountFixer);
  }

  const tx = await pair.swap(amount0Out, amount1Out, wallet.address, "0x", { gasLimit: GAS_LIMIT });
  await tx.wait();
}

async function sellFixer(wallet, amountFixer) {
  const pair = new ethers.Contract(AERO_PAIR, PAIR_ABI, wallet);

  const amountOutUSDC = await getAmountsOutFromPair(pair, amountFixer, FIXER, USDC);

  const t0 = await pair.token0();
  const t1 = await pair.token1();

  let amount0Out = 0n;
  let amount1Out = 0n;

  if (t0.toLowerCase() === USDC.toLowerCase()) {
    amount0Out = BigInt(amountOutUSDC);
  } else {
    amount1Out = BigInt(amountOutUSDC);
  }

  const tx = await pair.swap(amount0Out, amount1Out, wallet.address, "0x", { gasLimit: GAS_LIMIT });
  await tx.wait();
}

setInterval(async () => {
  if (!botRunning) return;

  const now = Date.now();

  if (pointer >= schedule.length) {
    wallets = buildWallets();
    schedule = buildSchedule();
    pointer = 0;
    return;
  }

  if (now < schedule[pointer]) return;

  const gasOK = await isGasCheapEnough();
  if (!gasOK) return;

  const w = pickWalletForNextTx();
  if (!w) return;

  const action = decideActionForWallet(w);
  if (!action) return;

  let amount = randomFixerAmount(w);

  if (action === "SELL" && w.netFixer > 0) {
    if (w.sells === 3) amount = w.netFixer;
    else if (amount > w.netFixer) amount = w.netFixer;
  }

  try {
    if (action === "BUY") {
      await buyFixer(w.wallet, amount);
      w.buys++;
      w.netFixer += amount;
    } else {
      await sellFixer(w.wallet, amount);
      w.sells++;
      w.netFixer -= amount;
      if (w.netFixer < 0) w.netFixer = 0;
    }
  } catch (e) {}

  pointer++;

}, 20000);

console.log("BOT READY → Listening on port", PORT);
app.listen(PORT);
