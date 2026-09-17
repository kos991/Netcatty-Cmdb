package store

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
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
	cleanPath, ok := databaseFilePath(dbPath)
	if !ok {
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
	cleanPath, ok := databaseFilePath(path)
	if !ok {
		return false
	}
	info, err := os.Stat(cleanPath)
	return err == nil && !info.IsDir() && info.Size() > 0
}

func databaseFilePath(dsn string) (string, bool) {
	if !strings.HasPrefix(dsn, "file:") {
		path := strings.SplitN(dsn, "?", 2)[0]
		return databasePathIsFile(path)
	}

	uri, err := url.Parse(dsn)
	if err != nil || uri.Query().Get("mode") == "memory" {
		return "", false
	}
	var path string
	if uri.Opaque != "" {
		path, err = url.PathUnescape(uri.Opaque)
		if err != nil {
			return "", false
		}
	} else if uri.Host != "" {
		path = "//" + uri.Host + uri.Path
	} else {
		path = uri.Path
	}
	path = filepath.FromSlash(path)
	if strings.HasPrefix(path, string(filepath.Separator)) {
		withoutLeadingSeparator := strings.TrimPrefix(path, string(filepath.Separator))
		if filepath.VolumeName(withoutLeadingSeparator) != "" {
			path = withoutLeadingSeparator
		}
	}
	return databasePathIsFile(path)
}

func databasePathIsFile(path string) (string, bool) {
	if path == "" || path == ":memory:" {
		return "", false
	}
	return path, true
}
