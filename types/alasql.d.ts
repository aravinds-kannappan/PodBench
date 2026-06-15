declare module "alasql" {
  // Minimal surface used by podbench. alasql is a pure-JS in-memory SQL engine,
  // which is what lets the environment be created and reset with no native deps.
  class Database {
    exec(sql: string, params?: unknown[]): any;
    tables: Record<string, unknown>;
  }
  interface AlaSQL {
    (sql: string, params?: unknown[]): any;
    Database: typeof Database;
  }
  const alasql: AlaSQL;
  export = alasql;
}
