import Ajv, { ValidateFunction } from "ajv";

import {
  BQRSInfo,
  QueryMetadata,
  ResolvedDatabase,
  ResolvedQueries,
  Sarif,
} from "./codeql";
import BQRSInfoSchema from "./json-schemas/BQRSInfo.json";
import queryMetadataSchema from "./json-schemas/QueryMetadata.json";
import ResolvedDatabaseSchema from "./json-schemas/ResolvedDatabase.json";
import ResolvedQueriesSchema from "./json-schemas/ResolvedQueries.json";
import sarifSchema from "./json-schemas/Sarif.json";

type SchemaTypes = {
  sarif: Sarif;
  bqrsInfo: BQRSInfo;
  resolvedQueries: ResolvedQueries;
  resolvedDatabase: ResolvedDatabase;
  queryMetadata: QueryMetadata;
};
type Schema = keyof SchemaTypes;

const ajv = new Ajv();
const validators: Record<Schema, ValidateFunction> = {
  sarif: ajv.compile(sarifSchema),
  bqrsInfo: ajv.compile(BQRSInfoSchema),
  resolvedQueries: ajv.compile(ResolvedQueriesSchema),
  resolvedDatabase: ajv.compile(ResolvedDatabaseSchema),
  queryMetadata: ajv.compile(queryMetadataSchema),
};
export const schemaNames = Object.keys(validators) as Schema[];

export class SchemaValidationError extends Error {}

export function validateObject<T extends Schema>(
  obj: unknown,
  schema: T
): SchemaTypes[T] {
  const validator = validators[schema];
  if (!validator(obj)) {
    throw new SchemaValidationError(
      `Object does not match the "${schema}" schema: ${ajv.errorsText(
        validator.errors
      )}`
    );
  }
  return obj as SchemaTypes[T];
}
