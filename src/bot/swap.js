const { calculateProfit, toDecimal, storeItInTempAsJSON } = require("../utils");
const cache = require("./cache");
const { setTimeout } = require("timers/promises");
const { balanceCheck } = require("./setup");
const { checktrans } = require("../utils/transaction.js");
const promiseRetry = require("promise-retry");

const waitabit = async (ms) => {
    const mySecondPromise = new Promise(function(resolve, reject) {
        console.log('Constructing a promise...');
        setTimeout(() => {
            reject(console.log('Error in promise'));
        }, ms);
    });
};

const swap = async (jupiter, route, wallet) => {
    try {
        const performanceOfTxStart = performance.now();
        cache.performanceOfTxStart = performanceOfTxStart;

        if (process.env.DEBUG) storeItInTempAsJSON("routeInfoBeforeSwap", route);

        const priority = typeof cache.config.priority === "number" ? cache.config.priority : 100; // Default 100 BPS
        cache.priority = priority;

        const txId = await jupiter.executeTransaction({
            route,
            wallet,
        });

        if (process.env.DEBUG) storeItInTempAsJSON("transactionResult", { txId });

        // Reset counter on success
        cache.tradeCounter.failedbalancecheck = 0;
        cache.tradeCounter.errorcount = 0;

        const performanceOfTx = performance.now() - performanceOfTxStart;

        return [txId, performanceOfTx];
    } catch (error) {
        console.log("Swap error: ", error);
    }
};
exports.swap = swap;

const failedSwapHandler = async (tradeEntry, inputToken, tradeAmount) => {
    cache.tradeCounter[cache.sideBuy ? "buy" : "sell"].fail++;

    if (cache.config.storeFailedTxInHistory) {
        cache.tradeHistory.push(tradeEntry);
    }

    const realBalanceToken = await balanceCheck(inputToken);

    if (Number(realBalanceToken) < Number(tradeAmount)) {
        cache.tradeCounter.failedbalancecheck++;

        if (cache.tradeCounter.failedbalancecheck > 5) {
            console.log(`Balance too low for token: ${realBalanceToken} < ${tradeAmount}`);
            console.log(`Failed ${cache.tradeCounter.failedbalancecheck} times`);
            process.exit();
        }
    }

    cache.tradeCounter.errorcount++;
    if (cache.tradeCounter.errorcount > 100) {
        console.log(`Error count too high for swaps: ${cache.tradeCounter.errorcount}`);
        console.log('Ending to stop endless transaction failures');
        process.exit();
    }
};
exports.failedSwapHandler = failedSwapHandler;

const successSwapHandler = async (txId, tradeEntry, tokenA, tokenB) => {
    if (process.env.DEBUG) storeItInTempAsJSON(`txResultFromSDK_${txId}`, { txId });

    cache.tradeCounter[cache.sideBuy ? "buy" : "sell"].success++;

    if (cache.config.tradingStrategy === "pingpong") {
        if (cache.sideBuy) {
            cache.lastBalance.tokenA = cache.currentBalance.tokenA;
            cache.currentBalance.tokenA = 0;
            cache.currentBalance.tokenB += txId.outputAmount;
        } else {
            cache.lastBalance.tokenB = cache.currentBalance.tokenB;
            cache.currentBalance.tokenB = 0;
            cache.currentBalance.tokenA += txId.outputAmount;
        }

        if (cache.sideBuy) {
            cache.currentProfit.tokenA = 0;
            cache.currentProfit.tokenB = calculateProfit(
                String(cache.initialBalance.tokenB),
                String(cache.currentBalance.tokenB)
            );
        } else {
            cache.currentProfit.tokenB = 0;
            cache.currentProfit.tokenA = calculateProfit(
                String(cache.initialBalance.tokenA),
                String(cache.currentBalance.tokenA)
            );
        }

        let tempHistory = cache.tradeHistory;

        tradeEntry.inAmount = toDecimal(
            txId.inputAmount,
            cache.sideBuy ? tokenA.decimals : tokenB.decimals
        );
        tradeEntry.outAmount = toDecimal(
            txId.outputAmount,
            cache.sideBuy ? tokenB.decimals : tokenA.decimals
        );

        tradeEntry.profit = calculateProfit(
            String(cache.lastBalance[cache.sideBuy ? "tokenB" : "tokenA"]),
            String(txId.outputAmount)
        );
        tempHistory.push(tradeEntry);
        cache.tradeHistory = tempHistory;
    }
};
exports.successSwapHandler = successSwapHandler;

