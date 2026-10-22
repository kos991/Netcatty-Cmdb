package store

import (
	"errors"
	"testing"
)

func TestEmptyStoreAdoptsCloudProjectAndReceivesRecords(t *testing.T) {
	remote, remoteScope := openSnapshotTestStore(t)
	local, localScope := openSnapshotTestStore(t)
	insertSnapshotTerminal(t, remote, remoteScope, "PC-CLOUD", "10.20.31.10")
	snapshot, err := remote.ExportCmdbSnapshot(remoteScope, SnapshotExportOptions{IncludeContacts: true, IncludeHistory: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := local.PreflightCmdbSnapshot(localScope, snapshot); err == nil {
		t.Fatal("接入前两台机器项目标识不同，预检应拒绝")
	}

	adopted, err := local.AdoptCmdbSnapshotProject(localScope, snapshot)
	if err != nil || !adopted {
		t.Fatalf("空库应接入云端项目: adopted=%v err=%v", adopted, err)
	}
	preview, err := local.PreflightCmdbSnapshot(localScope, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Conflicts != 0 || preview.UnresolvedReferences != 0 || preview.Added != 1 {
		t.Fatalf("接入后应只新增云端终端，内置目录不冲突: %+v", preview)
	}
	if _, err := local.ApplyCmdbSnapshot(localScope, snapshot); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := local.db.QueryRow(`SELECT COUNT(*) FROM assets WHERE project_id=? AND asset_code='PC-CLOUD'`, localScope.ProjectID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("云端终端应同步到本机: count=%d err=%v", count, err)
	}
	var tombstones int
	if err := local.db.QueryRow(`SELECT COUNT(*) FROM cmdb_tombstones WHERE project_id=?`, localScope.ProjectID).Scan(&tombstones); err != nil || tombstones != 0 {
		t.Fatalf("接入项目不得产生删除记录: %d %v", tombstones, err)
	}
	again, err := local.AdoptCmdbSnapshotProject(localScope, snapshot)
	if err != nil || again {
		t.Fatalf("标识一致后不应重复接入: adopted=%v err=%v", again, err)
	}
}

func TestStoreWithDataRefusesToAdoptAnotherProject(t *testing.T) {
	remote, remoteScope := openSnapshotTestStore(t)
	local, localScope := openSnapshotTestStore(t)
	insertSnapshotTerminal(t, local, localScope, "PC-LOCAL-ONLY", "10.20.31.20")
	before, err := local.ResolveProject(localScope)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := remote.ExportCmdbSnapshot(remoteScope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := local.AdoptCmdbSnapshotProject(localScope, snapshot); !errors.Is(err, ErrCmdbSnapshotProjectMismatch) {
		t.Fatalf("本机已有数据时应拒绝接入: %v", err)
	}
	after, err := local.ResolveProject(localScope)
	if err != nil {
		t.Fatal(err)
	}
	if after.SyncID != before.SyncID {
		t.Fatal("拒绝接入时不得修改本机项目标识")
	}
}
