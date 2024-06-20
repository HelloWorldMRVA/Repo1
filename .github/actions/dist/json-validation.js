"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateObject = exports.SchemaValidationError = exports.schemaNames = void 0;
const ajv_1 = __importDefault(require("ajv"));
const BQRSInfo_json_1 = __importDefault(require("./json-schemas/BQRSInfo.json"));
const QueryMetadata_json_1 = __importDefault(require("./json-schemas/QueryMetadata.json"));
const ResolvedDatabase_json_1 = __importDefault(require("./json-schemas/ResolvedDatabase.json"));
const ResolvedQueries_json_1 = __importDefault(require("./json-schemas/ResolvedQueries.json"));
const Sarif_json_1 = __importDefault(require("./json-schemas/Sarif.json"));
const ajv = new ajv_1.default();
const validators = {
    sarif: ajv.compile(Sarif_json_1.default),
    bqrsInfo: ajv.compile(BQRSInfo_json_1.default),
    resolvedQueries: ajv.compile(ResolvedQueries_json_1.default),
    resolvedDatabase: ajv.compile(ResolvedDatabase_json_1.default),
    queryMetadata: ajv.compile(QueryMetadata_json_1.default),
};
exports.schemaNames = Object.keys(validators);
class SchemaValidationError extends Error {
}
exports.SchemaValidationError = SchemaValidationError;
function validateObject(obj, schema) {
    const validator = validators[schema];
    if (!validator(obj)) {
        throw new SchemaValidationError(`Object does not match the "${schema}" schema: ${ajv.errorsText(validator.errors)}`);
    }
    return obj;
}
exports.validateObject = validateObject;
