console.clear();

require("dotenv").config();
const { clearInterval } = require("timers");
const { PublicKey } = require("@solana/web3.js");
const JSBI = require('jsbi');
const { setTimeout } = require("timers/promises");
const {
	calculateProfit,
	toDecimal,
	toNumber,
	updateIterationsPerMin,
	checkRoutesResponse,
	checkArbReady,
} = require("../utils");
const { handleExit, logExit } = require("./exit");
const cache = require("./cache");
const { setup, getInitialotherAmountThreshold, checkTokenABalance } = require("./setup");
const { printToConsole } = require("./ui/");
const { swap, failedSwapHandler, successSwapHandler } = require("./swap");

const waitabit = async (ms) => {
	return new Promise((resolve) => setTimeout(resolve, ms));
};

function getRandomAmt(runtime) {
	const min = Math.ceil((runtime * 10000) * 0.99);
	const max = Math.floor((runtime * 10000) * 1.01);
	return ((Math.floor(Math.random() * (max - min + 1)) + min) / 10000);
}

const pingpongStrategy = async (jupiter, tokenA, tokenB, wallet) => {
	cache.iteration++;
	const date = new Date();
	const i = cache.iteration;
	cache.queue[i] = -1;

	try {
		updateIterationsPerMin(cache);

		const amountToTrade =
			cache.config.tradeSize.strategy === "cumulative"
				? cache.currentBalance[cache.sideBuy ? "tokenA" : "tokenB"]
				: cache.initialBalance[cache.sideBuy ? "tokenA" : "tokenB"];

		if (!amountToTrade) {
			throw new Error("Amount to trade is not defined.");
		}

		const baseAmount = cache.lastBalance[cache.sideBuy ? "tokenB" : "tokenA"];
		const slippage = typeof cache.config.slippage === "number" ? cache.config.slippage : 1;

		const inputToken = cache.sideBuy ? tokenA : tokenB;
		const outputToken = cache.sideBuy ? tokenB : tokenA;

		if (!inputToken || !outputToken) {
			throw new Error("Input or output token is undefined.");
		}

		const routes = await jupiter.getRoutes({
			inputMint: inputToken.address,
			outputMint: outputToken.address,
			amount: amountToTrade.toString(),
			slippageBps: slippage,
		});

		checkRoutesResponse(routes);

		if (!routes || routes.length === 0) {
			throw new Error("No routes found for the input and output tokens.");
		}

		cache.availableRoutes[cache.sideBuy ? "buy" : "sell"] = routes.length;
		cache.queue[i] = 0;

		const route = routes[0];
		const simulatedProfit = calculateProfit(String(baseAmount), route.outAmount);

		if (simulatedProfit > cache.maxProfitSpotted[cache.sideBuy ? "buy" : "sell"]) {
			cache.maxProfitSpotted[cache.sideBuy ? "buy" : "sell"] = simulatedProfit;
		}

		printToConsole({
			date,
			i,
			inputToken,
			outputToken,
			tokenA,
			tokenB,
			route,
			simulatedProfit,
		});

		let tx;
		if (!cache.swappingRightNow && simulatedProfit >= cache.config.minPercProfit) {
			cache.swappingRightNow = true;

			let tradeEntry = {
				date: date.toLocaleString(),
				buy: cache.sideBuy,
				inputToken: inputToken.symbol,
				outputToken: outputToken.symbol,
				inAmount: toDecimal(route.amount, inputToken.decimals),
				expectedOutAmount: toDecimal(route.outAmount, outputToken.decimals),
				expectedProfit: simulatedProfit,
			};

			tx = await swap(jupiter, route, wallet);

			if (tx.error) {
				await failedSwapHandler(tradeEntry, inputToken, amountToTrade);
			} else {
				await successSwapHandler(tx, tradeEntry, tokenA, tokenB);
			}
		}

		if (tx && !tx.error) {
			cache.sideBuy = !cache.sideBuy;
			cache.swappingRightNow = false;
		}

		printToConsole({
			date,
			i,
			inputToken,
			outputToken,
			tokenA,
			tokenB,
			route,
			simulatedProfit,
		});
	} catch (error) {
		cache.queue[i] = 1;
		console.error("PingPong Strategy Error:", error.message);
	} finally {
		delete cache.queue[i];
	}
};

const run = async () => {
	try {
		await checkArbReady();
		const { jupiter, tokenA, tokenB, wallet } = await setup();

		cache.walletpubkeyfull = wallet.publicKey.toString();
		cache.walletpubkey = cache.walletpubkeyfull.slice(0, 5) + '...' + cache.walletpubkeyfull.slice(-3);

		if (cache.config.tradingStrategy === "pingpong") {
			cache.initialBalance.tokenA = toNumber(cache.config.tradeSize.value, tokenA.decimals);
			cache.currentBalance.tokenA = cache.initialBalance.tokenA;
			cache.lastBalance.tokenA = cache.initialBalance.tokenA;
			await checkTokenABalance(tokenA, cache.initialBalance.tokenA);

			cache.initialBalance.tokenB = await getInitialotherAmountThreshold(
				jupiter,
				tokenA,
				tokenB,
				cache.initialBalance.tokenA
			);
			cache.lastBalance.tokenB = cache.initialBalance.tokenB;
		}

		global.botInterval = setInterval(() => {
			pingpongStrategy(jupiter, tokenA, tokenB, wallet);
		}, cache.config.minInterval);
	} catch (error) {
		logExit(error);
		process.exitCode = 1;
	}
};

run();

process.on("exit", handleExit);

