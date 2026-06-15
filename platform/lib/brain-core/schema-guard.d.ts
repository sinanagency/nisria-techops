export type SchemaManifest = Record<string, string[]>;
export type SchemaMissing = {
    table: string;
    column: string;
};
export type SchemaDriftCode = {
    table: string;
    code: string;
    message: string;
};
export type SchemaCheckResult = {
    ok: boolean;
    missing: SchemaMissing[];
    driftCodes: SchemaDriftCode[];
    checkedTables: number;
    checkedColumns: number;
};
export interface SchemaCheckDb {
    from(table: string): {
        select(cols: string): {
            limit(n: number): Promise<{
                error: {
                    code?: string;
                    message?: string;
                } | null;
            }>;
        };
    };
}
export type SchemaCheckOpts = {
    db: SchemaCheckDb;
    manifest: SchemaManifest;
};
export declare function checkSchema(opts: SchemaCheckOpts): Promise<SchemaCheckResult>;
export declare function formatSchemaResult(r: SchemaCheckResult): string;
//# sourceMappingURL=schema-guard.d.ts.map