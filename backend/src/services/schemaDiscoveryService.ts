import { query } from '../db.js';

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  foreignTable?: string;
  foreignColumn?: string;
  comment?: string;
}

export interface TableInfo {
  tableName: string;
  tableSchema: string;
  tableType: 'BASE TABLE' | 'VIEW';
  columns: Record<string, ColumnInfo>;
  primaryKeys: string[];
  foreignKeys: Array<{
    columnName: string;
    foreignTable: string;
    foreignColumn: string;
  }>;
  indexes: string[];
  estimatedRowCount: number;
}

export interface DatabaseSchema {
  discoveredAt: string;
  tables: Record<string, TableInfo>;
}

class SchemaDiscoveryService {
  private cachedSchema: DatabaseSchema | null = null;
  private cacheExpiresAt: number = 0;
  private readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  /**
   * Discovers and returns the full schema of the accessible PostgreSQL database.
   * Uses cached metadata if fresh, or re-inspects PostgreSQL system catalogs.
   */
  public async discoverSchema(forceRefresh = false): Promise<DatabaseSchema> {
    const now = Date.now();
    if (!forceRefresh && this.cachedSchema && now < this.cacheExpiresAt) {
      return this.cachedSchema;
    }

    try {
      console.log('[SchemaDiscovery] Inspecting PostgreSQL information_schema and catalogs...');

      // 1. Discover all tables and views in public schema
      const tablesRes = await query<{
        table_name: string;
        table_schema: string;
        table_type: string;
      }>(`
        SELECT table_name, table_schema, table_type
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type IN ('BASE TABLE', 'VIEW')
          AND table_name NOT IN ('pgmigrations')
        ORDER BY table_name;
      `);

      // 2. Discover columns and data types
      const colsRes = await query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(`
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position;
      `);

      // 3. Discover Primary Keys
      const pkRes = await query<{
        table_name: string;
        column_name: string;
      }>(`
        SELECT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public';
      `);

      // 4. Discover Foreign Keys
      const fkRes = await query<{
        table_name: string;
        column_name: string;
        foreign_table: string;
        foreign_column: string;
      }>(`
        SELECT
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table,
          ccu.column_name AS foreign_column
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public';
      `);

      // 5. Discover Table row counts
      const countRes = await query<{
        relname: string;
        n_live_tup: string;
      }>(`
        SELECT relname, n_live_tup
        FROM pg_stat_user_tables
        WHERE schemaname = 'public';
      `);

      const tablesMap: Record<string, TableInfo> = {};

      for (const t of tablesRes.rows) {
        tablesMap[t.table_name] = {
          tableName: t.table_name,
          tableSchema: t.table_schema,
          tableType: t.table_type as 'BASE TABLE' | 'VIEW',
          columns: {},
          primaryKeys: [],
          foreignKeys: [],
          indexes: [],
          estimatedRowCount: 0
        };
      }

      for (const row of countRes.rows) {
        if (tablesMap[row.relname]) {
          tablesMap[row.relname].estimatedRowCount = parseInt(row.n_live_tup || '0', 10);
        }
      }

      for (const c of colsRes.rows) {
        if (!tablesMap[c.table_name]) continue;
        tablesMap[c.table_name].columns[c.column_name] = {
          name: c.column_name,
          dataType: c.data_type,
          isNullable: c.is_nullable === 'YES',
          defaultValue: c.column_default,
          isPrimaryKey: false,
          isForeignKey: false
        };
      }

      for (const pk of pkRes.rows) {
        if (tablesMap[pk.table_name]) {
          tablesMap[pk.table_name].primaryKeys.push(pk.column_name);
          if (tablesMap[pk.table_name].columns[pk.column_name]) {
            tablesMap[pk.table_name].columns[pk.column_name].isPrimaryKey = true;
          }
        }
      }

      for (const fk of fkRes.rows) {
        if (tablesMap[fk.table_name]) {
          tablesMap[fk.table_name].foreignKeys.push({
            columnName: fk.column_name,
            foreignTable: fk.foreign_table,
            foreignColumn: fk.foreign_column
          });
          if (tablesMap[fk.table_name].columns[fk.column_name]) {
            tablesMap[fk.table_name].columns[fk.column_name].isForeignKey = true;
            tablesMap[fk.table_name].columns[fk.column_name].foreignTable = fk.foreign_table;
            tablesMap[fk.table_name].columns[fk.column_name].foreignColumn = fk.foreign_column;
          }
        }
      }

      const discovered: DatabaseSchema = {
        discoveredAt: new Date().toISOString(),
        tables: tablesMap
      };

      this.cachedSchema = discovered;
      this.cacheExpiresAt = now + this.CACHE_TTL_MS;
      console.log(`[SchemaDiscovery] Discovered ${Object.keys(tablesMap).length} tables in PostgreSQL database.`);
      return discovered;
    } catch (err: any) {
      console.error('[SchemaDiscovery] Failed to inspect database schema:', err.message);
      if (this.cachedSchema) {
        return this.cachedSchema;
      }
      return {
        discoveredAt: new Date().toISOString(),
        tables: {}
      };
    }
  }

  public async refreshSchema(): Promise<DatabaseSchema> {
    return this.discoverSchema(true);
  }

  public getCachedSchema(): DatabaseSchema | null {
    return this.cachedSchema;
  }
}

export const schemaDiscoveryService = new SchemaDiscoveryService();
