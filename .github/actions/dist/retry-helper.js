"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RetryHelper = void 0;
const core = __importStar(require("@actions/core"));
/**
 * Internal class for retries.
 * Borrowed from https://github.com/actions/toolkit/blob/main/packages/tool-cache/src/retry-helper.ts.
 */
class RetryHelper {
    maxAttempts;
    minSeconds;
    maxSeconds;
    constructor(maxAttempts, minSeconds, maxSeconds) {
        if (maxAttempts < 1) {
            throw new Error("max attempts should be greater than or equal to 1");
        }
        this.maxAttempts = maxAttempts;
        this.minSeconds = Math.floor(minSeconds);
        this.maxSeconds = Math.floor(maxSeconds);
        if (this.minSeconds > this.maxSeconds) {
            throw new Error("min seconds should be less than or equal to max seconds");
        }
    }
    async execute(action, isRetryable) {
        let attempt = 1;
        while (attempt < this.maxAttempts) {
            // Try
            try {
                return await action();
            }
            catch (err) {
                if (!(err instanceof Error) || !isRetryable(err)) {
                    throw err;
                }
                core.info(err.message);
            }
            // Sleep
            const seconds = this.getSleepAmount();
            core.info(`Waiting ${seconds} seconds before trying again`);
            await this.sleep(seconds);
            attempt++;
        }
        // Last attempt
        return await action();
    }
    getSleepAmount() {
        return (Math.floor(Math.random() * (this.maxSeconds - this.minSeconds + 1)) +
            this.minSeconds);
    }
    async sleep(seconds) {
        return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
}
exports.RetryHelper = RetryHelper;
