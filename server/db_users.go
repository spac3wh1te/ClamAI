package main

import (
	"database/sql"
	"time"
)

func dbCreateUser(id, username, displayName, passwordHash, role string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
		id, username, displayName, passwordHash, role, now, now)
	return err
}

func dbGetUserByUsername(username string) (map[string]interface{}, error) {
	row := db.QueryRow("SELECT id, username, display_name, password_hash, role, status, created_at, updated_at, last_login_at FROM users WHERE username = ?", username)
	var id, uname, displayName, hash, role, status string
	var createdAt, updatedAt string
	var lastLogin sql.NullString
	if err := row.Scan(&id, &uname, &displayName, &hash, &role, &status, &createdAt, &updatedAt, &lastLogin); err != nil {
		return nil, err
	}
	user := map[string]interface{}{
		"id": id, "username": uname, "display_name": displayName,
		"password_hash": hash, "role": role, "status": status,
		"created_at": createdAt, "updated_at": updatedAt,
	}
	if lastLogin.Valid {
		user["last_login_at"] = lastLogin.String
	}
	return user, nil
}

func dbGetUserByID(id string) (map[string]interface{}, error) {
	row := db.QueryRow("SELECT id, username, display_name, password_hash, role, status, created_at, updated_at, last_login_at FROM users WHERE id = ?", id)
	var uid, uname, displayName, hash, role, status string
	var createdAt, updatedAt string
	var lastLogin sql.NullString
	if err := row.Scan(&uid, &uname, &displayName, &hash, &role, &status, &createdAt, &updatedAt, &lastLogin); err != nil {
		return nil, err
	}
	user := map[string]interface{}{
		"id": uid, "username": uname, "display_name": displayName,
		"password_hash": hash, "role": role, "status": status,
		"created_at": createdAt, "updated_at": updatedAt,
	}
	if lastLogin.Valid {
		user["last_login_at"] = lastLogin.String
	}
	return user, nil
}

func dbListUsers() ([]map[string]interface{}, error) {
	rows, err := db.Query("SELECT id, username, display_name, role, status, created_at, updated_at, last_login_at FROM users ORDER BY created_at ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []map[string]interface{}
	for rows.Next() {
		var id, username, displayName, role, status string
		var createdAt, updatedAt string
		var lastLogin sql.NullString
		if err := rows.Scan(&id, &username, &displayName, &role, &status, &createdAt, &updatedAt, &lastLogin); err != nil {
			continue
		}
		user := map[string]interface{}{
			"id": id, "username": username, "display_name": displayName,
			"role": role, "status": status, "created_at": createdAt, "updated_at": updatedAt,
		}
		if lastLogin.Valid {
			user["last_login_at"] = lastLogin.String
		}
		users = append(users, user)
	}
	return users, nil
}

func dbUpdateUser(id, displayName, role, status string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(`UPDATE users SET display_name=?, role=?, status=?, updated_at=? WHERE id=?`,
		displayName, role, status, now, id)
	return err
}

func dbUpdateUserPassword(id, passwordHash string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(`UPDATE users SET password_hash=?, updated_at=? WHERE id=?`, passwordHash, now, id)
	return err
}

func dbUpdateUserLastLogin(id string) {
	now := time.Now().UTC().Format(time.RFC3339)
	db.Exec(`UPDATE users SET last_login_at=? WHERE id=?`, now, id)
}

func dbDeleteUser(id string) error {
	_, err := db.Exec("DELETE FROM users WHERE id=?", id)
	return err
}

func dbUserExists() bool {
	var count int
	db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	return count > 0
}

func dbAdminExists() bool {
	var count int
	db.QueryRow("SELECT COUNT(*) FROM users WHERE role = 'admin'").Scan(&count)
	return count > 0
}

func dbAnyUserExists() bool {
	var count int
	db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	return count > 0
}

func dbGetSystemSetting(key string) string {
	var val string
	err := db.QueryRow("SELECT value FROM system_settings WHERE key = ?", key).Scan(&val)
	if err != nil {
		return ""
	}
	return val
}

func dbSetSystemSetting(key, value string) {
	db.Exec(`INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)`, key, value)
}

func dbIsRegistrationOpen() bool {
	return dbGetSystemSetting("registration_open") == "true"
}

func dbSetRegistrationOpen(open bool) {
	val := "false"
	if open {
		val = "true"
	}
	dbSetSystemSetting("registration_open", val)
}
