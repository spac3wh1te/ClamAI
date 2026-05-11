package main

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
)

var dbDriver string = "sqlite"

func initDBDriver() {
	if getGlobalConfig() != nil && getGlobalConfig().Host == "0.0.0.0" && os.Getenv("CLAMAI_DATABASE_TYPE") == "postgres" {
		dbDriver = "postgres"
	}
}

func isPostgres() bool {
	return dbDriver == "postgres"
}

func dbAutoIncrement() string {
	if isPostgres() {
		return "SERIAL PRIMARY KEY"
	}
	return "INTEGER PRIMARY KEY AUTOINCREMENT"
}

func dbBoolCheck(checkExpr string) string {
	if isPostgres() {
		return checkExpr
	}
	return checkExpr
}

func dbBoolLiteral(v bool) interface{} {
	if isPostgres() {
		if v {
			return true
		}
		return false
	}
	if v {
		return 1
	}
	return 0
}

func dbNow() string {
	if isPostgres() {
		return "NOW()"
	}
	return "DATETIME('now')"
}

func dbInsertOrReplace(table string, columns []string, values []interface{}) (sql.Result, error) {
	if isPostgres() {
		var cols, sets []string
		for _, c := range columns {
			cols = append(cols, c)
			sets = append(sets, fmt.Sprintf("%s = EXCLUDED.%s", c, c))
		}
		placeholders := makePlaceholders(len(columns))
		query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (id) DO UPDATE SET %s",
			table, strings.Join(cols, ", "), placeholders, strings.Join(sets, ", "))
		return db.Exec(query, values...)
	}
	placeholders := makePlaceholders(len(columns))
	query := fmt.Sprintf("INSERT OR REPLACE INTO %s (%s) VALUES (%s)",
		table, strings.Join(columns, ", "), placeholders)
	return db.Exec(query, values...)
}

func dbInsertOrIgnore(table string, columns []string, values []interface{}) (sql.Result, error) {
	if isPostgres() {
		placeholders := makePlaceholders(len(columns))
		query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT DO NOTHING",
			table, strings.Join(columns, ", "), placeholders)
		return db.Exec(query, values...)
	}
	placeholders := makePlaceholders(len(columns))
	query := fmt.Sprintf("INSERT OR IGNORE INTO %s (%s) VALUES (%s)",
		table, strings.Join(columns, ", "), placeholders)
	return db.Exec(query, values...)
}

func makePlaceholders(n int) string {
	if isPostgres() {
		parts := make([]string, n)
		for i := range parts {
			parts[i] = fmt.Sprintf("$%d", i+1)
		}
		return strings.Join(parts, ", ")
	}
	parts := make([]string, n)
	for i := range parts {
		parts[i] = "?"
	}
	return strings.Join(parts, ", ")
}

func dbPlaceholder(idx int) string {
	if isPostgres() {
		return fmt.Sprintf("$%d", idx)
	}
	return "?"
}

func dbTruncateMinute(column string) string {
	if isPostgres() {
		return fmt.Sprintf("to_char(%s AT TIME ZONE 'localtime', 'YYYY-MM-DD HH24:MI')", column)
	}
	return fmt.Sprintf("STRFTIME('%%Y-%%m-%%d %%H:%%M', %s, 'localtime')", column)
}

func dbTruncateHour(column string) string {
	if isPostgres() {
		return fmt.Sprintf("to_char(%s AT TIME ZONE 'localtime', 'YYYY-MM-DD HH24:00')", column)
	}
	return fmt.Sprintf("STRFTIME('%%Y-%%m-%%d %%H:00', %s, 'localtime')", column)
}

func dbTruncateDay(column string) string {
	if isPostgres() {
		return fmt.Sprintf("to_char(%s AT TIME ZONE 'localtime', 'YYYY-MM-DD')", column)
	}
	return fmt.Sprintf("DATE(%s, 'localtime')", column)
}

func dbGroupConcat(expr string, sep string) string {
	if isPostgres() {
		return fmt.Sprintf("STRING_AGG(%s, '%s')", expr, sep)
	}
	return fmt.Sprintf("GROUP_CONCAT(%s, '%s')", expr, sep)
}
