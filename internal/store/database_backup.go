package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const projectSchemaVersion = "1"

type MigrationError struct {
	BackupPath string
	Err        error
}

func (e *MigrationError) Error() string {
	return fmt.Sprintf("数据库迁移失败，已保留安全备份 %s: %v", e.BackupPath, e.Err)
}

func (e *MigrationError) Unwrap() error {
	return e.Err
}

func NeedsProjectMigration(db *sql.DB) (bool, error) {
	var metaExists int
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_meta'
	`).Scan(&metaExists); err != nil {
		return false, fmt.Errorf("check metadata table: %w", err)
	}
	if metaExists == 0 {
		return true, nil
	}
	var version string
	err := db.QueryRow(`SELECT v FROM _meta WHERE k = 'project_schema_version'`).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("read project schema version: %w", err)
	}
	return version != projectSchemaVersion, nil
}

func BackupDatabase(db *sql.DB, dbPath string) (string, error) {
	cleanPath := strings.SplitN(dbPath, "?", 2)[0]
	if cleanPath == "" || cleanPath == ":memory:" {
		return "", errors.New("数据库路径不支持安全备份")
	}
	absolutePath, err := filepath.Abs(cleanPath)
	if err != nil {
		return "", fmt.Errorf("resolve database path: %w", err)
	}
	backupPath := absolutePath + ".backup-" + time.Now().Format("20060102-150405.000000000")
	if _, err := db.Exec(`VACUUM INTO ?`, backupPath); err != nil {
		_ = os.Remove(backupPath)
		return "", fmt.Errorf("backup database: %w", err)
	}
	return backupPath, nil
}

func existingDatabaseFile(path string) bool {
	cleanPath := strings.SplitN(path, "?", 2)[0]
	if cleanPath == "" || cleanPath == ":memory:" {
		return false
	}
	info, err := os.Stat(cleanPath)
	return err == nil && !info.IsDir() && info.Size() > 0
}
