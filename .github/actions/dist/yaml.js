"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseYamlFromFile = exports.parseYaml = void 0;
const fs_1 = __importDefault(require("fs"));
const yaml_1 = require("yaml");
// Use a custom tag for floats in exponential notation, to make the +/- mandatory
// This fixes commit SHAs consisting only of numbers with a single "e" in them
const floatExp = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    format: "EXP",
    test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+][0-9]+$/, // Change is here, making the [-+] mandatory
    resolve: (str) => parseFloat(str.replace(/_/g, "")),
    stringify(node) {
        const num = Number(node.value);
        if (isFinite(num)) {
            return num.toExponential();
        }
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
    },
};
function parseYaml(src) {
    return (0, yaml_1.parse)(src, {
        version: "1.1", // CodeQL CLI uses YAML 1.1
        schema: "yaml-1.1",
        intAsBigInt: true, // We want to retrieve the complete original commit SHA, which we can't do if it's parsed as a float
        customTags: (tags) => {
            // Remove the original float EXP tag, and add our custom one
            const tagsWithoutFloatExp = tags.filter((tag) => {
                if (typeof tag !== "object" || !tag.tag) {
                    return true;
                }
                return tag.tag !== "tag:yaml.org,2002:float" && tag.format !== "EXP";
            });
            return [floatExp, ...tagsWithoutFloatExp];
        },
    });
}
exports.parseYaml = parseYaml;
function parseYamlFromFile(filePath) {
    return parseYaml(fs_1.default.readFileSync(filePath, "utf8"));
}
exports.parseYamlFromFile = parseYamlFromFile;
