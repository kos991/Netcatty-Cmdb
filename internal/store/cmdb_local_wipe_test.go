package store

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWipeLocalCmdbDataBacksUpClearsAndRejoinsCloud(t *testing.T) {
	cloud, cloudScope := openSnapshotTestStore(t)
	insertSnapshotTerminal(t, cloud, cloudScope, "PC-SHARED", "10.20.32.10")
	shared, err := cloud.ExportCmdbSnapshot(cloudScope, SnapshotExportOptions{IncludeContacts: true, IncludeHistory: true})
	if err != nil {
		t.Fatal(err)
	}

	local, localScope := openSnapshotTestStore(t)
	if _, err := local.AdoptCmdbSnapshotProject(localScope, shared); err != nil {
		t.Fatal(err)
	}
	if _, err := local.ApplyCmdbSnapshot(localScope, shared); err != nil {
		t.Fatal(err)
	}
	attachmentRoot, err := local.AttachmentRootForProject(localScope)
	if err != nil {
		t.Fatal(err)
	}
	casFile := filepath.Join(attachmentRoot, "cas", "ab", "cd", "abcd.bin")
	if err := os.MkdirAll(filepath.Dir(casFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(casFile, []byte("attachment"), 0o600); err != nil {
		t.Fatal(err)
	}
	userFile := filepath.Join(attachmentRoot, "keep.txt")
	if err := os.WriteFile(userFile, []byte("user"), 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := local.WipeLocalCmdbData(localScope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(result.BackupPath); err != nil {
		t.Fatalf("清空前应生成数据库备份: %v", err)
	}
	var assets, tombstones int
	if err := local.db.QueryRow(`SELECT COUNT(*) FROM assets WHERE project_id=?`, localScope.ProjectID).Scan(&assets); err != nil || assets != 0 {
		t.Fatalf("本机终端应被清空: %d %v", assets, err)
	}
	if err := local.db.QueryRow(`SELECT COUNT(*) FROM cmdb_tombstones WHERE project_id=?`, localScope.ProjectID).Scan(&tombstones); err != nil || tombstones != 0 {
		t.Fatalf("清空本机不得写删除记录，否则会删掉云端数据: %d %v", tombstones, err)
	}
	if _, err := os.Stat(casFile); !os.IsNotExist(err) {
		t.Fatalf("本地附件文件应被删除: %v", err)
	}
	if _, err := os.Stat(userFile); err != nil {
		t.Fatalf("附件目录中非 Cmdb 写入的文件不应删除: %v", err)
	}
	items, err := local.ListConfigItems(localScope, ConfigKindNetworkTypes)
	if err != nil || len(items) != 3 {
		t.Fatalf("清空后应恢复三种默认网络类型: %+v %v", items, err)
	}

	// 下一次同步：空库重新接入云端项目，并下载云端数据。
	if _, err := local.AdoptCmdbSnapshotProject(localScope, shared); err != nil {
		t.Fatalf("清空后应能重新接入云端项目: %v", err)
	}
	preview, err := local.PreflightCmdbSnapshot(localScope, shared)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Added != 1 || preview.Conflicts != 0 || preview.Deleted != 0 {
		t.Fatalf("清空后同步应重新下载云端终端: %+v", preview)
	}
}
