package store

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func openSnapshotTestStore(t *testing.T) (*Store, ProjectScope) {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "snapshot.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	scope, err := st.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	return st, scope
}

func TestCmdbSnapshotHashMatchesNetcattyGoldenValue(t *testing.T) {
	snapshot := &CmdbSnapshot{
		SchemaVersion: 1,
		ProjectSyncID: "project-golden",
		GeneratedAt:   "2026-09-21T10:00:00Z",
		Collections: map[string]json.RawMessage{
			"servers": json.RawMessage(`[]`),
			"assets":  json.RawMessage(`[{"sync_id":"asset-a","revision":1,"name":"终端 A"}]`),
		},
		Tombstones: []Tombstone{{
			EntityType: "assets",
			SyncID:     "asset-z",
			Revision:   2,
			DeletedAt:  "2026-09-21T10:01:00Z",
		}},
	}
	got, err := snapshotContentHash(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	const want = "aaa3c9e67d93735c764fd0c29db3c946ff11aed77e2a1bc0c49a734f5b7e46d2"
	if got != want {
		t.Fatalf("Go 与 Netcatty 快照摘要不一致: got %s want %s", got, want)
	}
}

func TestCmdbSnapshotIsStableAndOmitsLocalIDsAndPrivateFields(t *testing.T) {
	st, scope := openSnapshotTestStore(t)
	if _, err := st.db.Exec(`INSERT INTO assets(project_id,asset_code,device_type,user_name,ip,status) VALUES(?,?,?,?,?,?)`,
		scope.ProjectID, "PC-001", "台式电脑", "张三", "10.20.30.8", "在用"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.Exec(`INSERT INTO cmdb_persons(project_id,person_code,name,department,phone,email,status) VALUES(?,?,?,?,?,?,?)`,
		scope.ProjectID, "P001", "张三", "信息技术处", "13800000000", "private@example.invalid", "在职"); err != nil {
		t.Fatal(err)
	}
	assetResult, err := st.db.Exec(`INSERT INTO cmdb_assets(project_id,name,status) VALUES(?,?,?)`, scope.ProjectID, "核心交换机", "在用")
	if err != nil {
		t.Fatal(err)
	}
	cmdbAssetID, err := assetResult.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.Exec(`INSERT INTO cmdb_asset_history(project_id,asset_id,event_type,description,occurred_at) VALUES(?,?,?,?,?)`,
		scope.ProjectID, cmdbAssetID, "create", "首次登记", "2026-09-21 09:00:00"); err != nil {
		t.Fatal(err)
	}

	first, err := st.ExportCmdbSnapshot(scope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	second, err := st.ExportCmdbSnapshot(scope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if first.BaseHash == "" || first.BaseHash != second.BaseHash {
		t.Fatalf("相同数据库状态应生成稳定摘要: %q != %q", first.BaseHash, second.BaseHash)
	}
	if first.ProjectSyncID == "" {
		t.Fatal("快照缺少项目稳定标识")
	}
	encoded, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(encoded, &document); err != nil {
		t.Fatal(err)
	}
	collections := document["collections"].(map[string]any)
	assets := collections["assets"].([]any)
	asset := assets[0].(map[string]any)
	if _, exists := asset["id"]; exists {
		t.Fatal("规范快照不得包含本机自增 ID")
	}
	if _, exists := asset["project_id"]; exists {
		t.Fatal("规范快照不得包含本机项目 ID")
	}
	persons := collections["cmdb_persons"].([]any)
	person := persons[0].(map[string]any)
	if _, exists := person["phone"]; exists {
		t.Fatal("未启用联系方式同步时不得导出电话")
	}
	if _, exists := person["email"]; exists {
		t.Fatal("邮箱不得进入同步快照")
	}
	if _, exists := collections["cmdb_asset_history"]; exists {
		t.Fatal("未启用履历同步时不得导出履历")
	}
}

func TestCmdbProjectTablesAutomaticallyAdvanceRevisionAndWriteTombstones(t *testing.T) {
	st, scope := openSnapshotTestStore(t)
	result, err := st.db.Exec(`INSERT INTO cmdb_work_orders(project_id,subject,status) VALUES(?,?,?)`, scope.ProjectID, "网络中断", "新建")
	if err != nil {
		t.Fatal(err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	var syncID string
	var revision int64
	if err := st.db.QueryRow(`SELECT sync_id,revision FROM cmdb_work_orders WHERE id=?`, id).Scan(&syncID, &revision); err != nil {
		t.Fatal(err)
	}
	if revision != 1 {
		t.Fatalf("新记录修订号应为 1，实际为 %d", revision)
	}
	if _, err := st.db.Exec(`UPDATE cmdb_work_orders SET subject=? WHERE id=?`, "核心交换机网络中断", id); err != nil {
		t.Fatal(err)
	}
	if err := st.db.QueryRow(`SELECT revision FROM cmdb_work_orders WHERE id=?`, id).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	if revision != 2 {
		t.Fatalf("业务更新后修订号应自动变为 2，实际为 %d", revision)
	}
	if _, err := st.db.Exec(`DELETE FROM cmdb_work_orders WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	var tombstoneRevision int64
	if err := st.db.QueryRow(`SELECT revision FROM cmdb_tombstones WHERE project_id=? AND entity_type=? AND sync_id=?`,
		scope.ProjectID, "cmdb_work_orders", syncID).Scan(&tombstoneRevision); err != nil {
		t.Fatal(err)
	}
	if tombstoneRevision != 3 {
		t.Fatalf("删除墓碑修订号应为 3，实际为 %d", tombstoneRevision)
	}
}

func alignSnapshotProject(t *testing.T, st *Store, scope ProjectScope, projectSyncID string) {
	t.Helper()
	if _, err := st.db.Exec(`UPDATE cmdb_projects SET sync_id=? WHERE id=?`, projectSyncID, scope.ProjectID); err != nil {
		t.Fatal(err)
	}
}

func insertSnapshotTerminal(t *testing.T, st *Store, scope ProjectScope, code, ip string) string {
	t.Helper()
	result, err := st.db.Exec(`INSERT INTO assets(project_id,asset_code,device_type,ip,status) VALUES(?,?,?,?,?)`,
		scope.ProjectID, code, "台式电脑", ip, "在用")
	if err != nil {
		t.Fatal(err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	var syncID string
	if err := st.db.QueryRow(`SELECT sync_id FROM assets WHERE id=?`, id).Scan(&syncID); err != nil {
		t.Fatal(err)
	}
	return syncID
}

func TestCmdbMergeAddsDifferentRecordsWithoutMutatingPreflight(t *testing.T) {
	remote, remoteScope := openSnapshotTestStore(t)
	local, localScope := openSnapshotTestStore(t)
	remoteProject, err := remote.ResolveProject(remoteScope)
	if err != nil {
		t.Fatal(err)
	}
	alignSnapshotProject(t, local, localScope, remoteProject.SyncID)
	insertSnapshotTerminal(t, remote, remoteScope, "PC-REMOTE", "10.20.30.20")
	insertSnapshotTerminal(t, local, localScope, "PC-LOCAL", "10.20.30.21")
	snapshot, err := remote.ExportCmdbSnapshot(remoteScope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}

	preview, err := local.PreflightCmdbSnapshot(localScope, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Added != 1 || preview.Conflicts != 0 {
		t.Fatalf("预检结果异常: %+v", preview)
	}
	var before int
	if err := local.db.QueryRow(`SELECT COUNT(*) FROM assets WHERE project_id=?`, localScope.ProjectID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if before != 1 {
		t.Fatalf("预检不得写库，实际记录数 %d", before)
	}

	result, err := local.ApplyCmdbSnapshot(localScope, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if result.Added != 1 || result.BaseHash == "" {
		t.Fatalf("应用结果异常: %+v", result)
	}
	backups, err := filepath.Glob(local.path + ".backup-*")
	if err != nil {
		t.Fatal(err)
	}
	if len(backups) != 1 {
		t.Fatalf("同步应用前应生成一个安全备份，实际 %v", backups)
	}
	var after int
	if err := local.db.QueryRow(`SELECT COUNT(*) FROM assets WHERE project_id=?`, localScope.ProjectID).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != 2 {
		t.Fatalf("不同记录应合并保留，实际记录数 %d", after)
	}
}

func TestCmdbMergeRejectsConcurrentRecordConflictWithoutPartialWrites(t *testing.T) {
	remote, remoteScope := openSnapshotTestStore(t)
	local, localScope := openSnapshotTestStore(t)
	remoteProject, err := remote.ResolveProject(remoteScope)
	if err != nil {
		t.Fatal(err)
	}
	alignSnapshotProject(t, local, localScope, remoteProject.SyncID)
	sharedSyncID := insertSnapshotTerminal(t, remote, remoteScope, "PC-REMOTE", "10.20.30.30")
	localSyncID := insertSnapshotTerminal(t, local, localScope, "PC-LOCAL", "10.20.30.31")
	if _, err := local.db.Exec(`UPDATE assets SET sync_id=? WHERE sync_id=?`, sharedSyncID, localSyncID); err != nil {
		t.Fatal(err)
	}
	if _, err := remote.db.Exec(`UPDATE assets SET revision=2 WHERE sync_id=?`, sharedSyncID); err != nil {
		t.Fatal(err)
	}
	snapshot, err := remote.ExportCmdbSnapshot(remoteScope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}

	preview, err := local.PreflightCmdbSnapshot(localScope, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Conflicts != 1 {
		t.Fatalf("同修订号不同内容应报告一个冲突: %+v", preview)
	}
	if _, err := local.ApplyCmdbSnapshot(localScope, snapshot); err == nil {
		t.Fatal("存在冲突时应用必须失败")
	}
	var code string
	if err := local.db.QueryRow(`SELECT asset_code FROM assets WHERE sync_id=?`, sharedSyncID).Scan(&code); err != nil {
		t.Fatal(err)
	}
	if code != "PC-LOCAL" {
		t.Fatalf("冲突失败后本地数据被部分覆盖: %s", code)
	}
}

func TestCmdbMergeTombstonePreventsDeletedRecordResurrection(t *testing.T) {
	remote, remoteScope := openSnapshotTestStore(t)
	local, localScope := openSnapshotTestStore(t)
	remoteProject, err := remote.ResolveProject(remoteScope)
	if err != nil {
		t.Fatal(err)
	}
	alignSnapshotProject(t, local, localScope, remoteProject.SyncID)
	sharedSyncID := insertSnapshotTerminal(t, remote, remoteScope, "PC-DELETED", "10.20.30.40")
	localSyncID := insertSnapshotTerminal(t, local, localScope, "PC-DELETED", "10.20.30.40")
	if _, err := local.db.Exec(`UPDATE assets SET sync_id=? WHERE sync_id=?`, sharedSyncID, localSyncID); err != nil {
		t.Fatal(err)
	}
	if _, err := local.db.Exec(`DELETE FROM assets WHERE sync_id=?`, sharedSyncID); err != nil {
		t.Fatal(err)
	}
	snapshot, err := remote.ExportCmdbSnapshot(remoteScope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	preview, err := local.PreflightCmdbSnapshot(localScope, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if preview.SuppressedByTombstone != 1 {
		t.Fatalf("已删除记录应被墓碑抑制: %+v", preview)
	}
	if _, err := local.ApplyCmdbSnapshot(localScope, snapshot); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := local.db.QueryRow(`SELECT COUNT(*) FROM assets WHERE sync_id=?`, sharedSyncID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("墓碑未阻止旧快照复活记录")
	}
}

func TestCmdbMergeRejectsDuplicateIPOwnership(t *testing.T) {
	remote, remoteScope := openSnapshotTestStore(t)
	local, localScope := openSnapshotTestStore(t)
	remoteProject, err := remote.ResolveProject(remoteScope)
	if err != nil {
		t.Fatal(err)
	}
	alignSnapshotProject(t, local, localScope, remoteProject.SyncID)
	insertSnapshotTerminal(t, remote, remoteScope, "PC-REMOTE", "10.20.30.50")
	insertSnapshotTerminal(t, local, localScope, "PC-LOCAL", "10.20.30.50")
	snapshot, err := remote.ExportCmdbSnapshot(remoteScope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	preview, err := local.PreflightCmdbSnapshot(localScope, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Conflicts == 0 {
		t.Fatalf("不同资产占用同一 IP 必须报告冲突: %+v", preview)
	}
}

func TestCmdbMergeTreatsLegacyProjectionAndInterfaceAsSameAsset(t *testing.T) {
	st, scope := openSnapshotTestStore(t)
	legacyResult, err := st.db.Exec(`INSERT INTO assets(project_id,asset_code,device_type,ip,status) VALUES(?,?,?,?,?)`,
		scope.ProjectID, "PC-001", "台式电脑", "10.20.30.50", "在用")
	if err != nil {
		t.Fatal(err)
	}
	legacyID, _ := legacyResult.LastInsertId()
	assetResult, err := st.db.Exec(`INSERT INTO cmdb_assets(project_id,asset_code,name,status,source_type,source_id,mgmt_ip) VALUES(?,?,?,?,?,?,?)`,
		scope.ProjectID, "PC-001", "终端投影", "在用", "legacy_asset", legacyID, "10.20.30.50")
	if err != nil {
		t.Fatal(err)
	}
	assetID, _ := assetResult.LastInsertId()
	if _, err := st.db.Exec(`INSERT INTO cmdb_asset_interfaces(project_id,asset_id,name,ip) VALUES(?,?,?,?)`,
		scope.ProjectID, assetID, "业务口", "10.20.30.50"); err != nil {
		t.Fatal(err)
	}
	snapshot, err := st.ExportCmdbSnapshot(scope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	preview, err := st.PreflightCmdbSnapshot(scope, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Conflicts != 0 || preview.UnresolvedReferences != 0 {
		t.Fatalf("同一逻辑资产的旧表、统一投影和网卡不应互相冲突: %+v", preview)
	}
}

func TestCmdbMergeResolvesAssetLinksByStableReferences(t *testing.T) {
	remote, remoteScope := openSnapshotTestStore(t)
	local, localScope := openSnapshotTestStore(t)
	remoteProject, err := remote.ResolveProject(remoteScope)
	if err != nil {
		t.Fatal(err)
	}
	alignSnapshotProject(t, local, localScope, remoteProject.SyncID)
	if _, err := local.db.Exec(`INSERT INTO cmdb_assets(project_id,name,status) VALUES(?,?,?)`, localScope.ProjectID, "本机占位资产", "在用"); err != nil {
		t.Fatal(err)
	}
	leftResult, err := remote.db.Exec(`INSERT INTO cmdb_assets(project_id,name,status,device_type) VALUES(?,?,?,?)`, remoteScope.ProjectID, "核心交换机", "在用", "交换机")
	if err != nil {
		t.Fatal(err)
	}
	leftID, _ := leftResult.LastInsertId()
	rightResult, err := remote.db.Exec(`INSERT INTO cmdb_assets(project_id,name,status,device_type) VALUES(?,?,?,?)`, remoteScope.ProjectID, "物理服务器", "在用", "服务器")
	if err != nil {
		t.Fatal(err)
	}
	rightID, _ := rightResult.LastInsertId()
	interfaceResult, err := remote.db.Exec(`INSERT INTO cmdb_asset_interfaces(project_id,asset_id,name,if_name,ip) VALUES(?,?,?,?,?)`, remoteScope.ProjectID, leftID, "上联口", "Gi0/1", "10.20.30.60")
	if err != nil {
		t.Fatal(err)
	}
	interfaceID, _ := interfaceResult.LastInsertId()
	if _, err := remote.db.Exec(`INSERT INTO cmdb_asset_links(project_id,local_asset_id,local_interface_id,local_port,direction,peer_asset_id,peer_port,status) VALUES(?,?,?,?,?,?,?,?)`,
		remoteScope.ProjectID, leftID, interfaceID, "Gi0/1", "downlink", rightID, "eth0", "在线"); err != nil {
		t.Fatal(err)
	}
	snapshot, err := remote.ExportCmdbSnapshot(remoteScope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	var links []map[string]any
	if err := json.Unmarshal(snapshot.Collections["cmdb_asset_links"], &links); err != nil {
		t.Fatal(err)
	}
	if len(links) != 1 {
		t.Fatalf("预期一个链路，实际 %d", len(links))
	}
	if _, exists := links[0]["local_asset_id"]; exists {
		t.Fatal("链路快照不得包含本机资产 ID")
	}
	refs, ok := links[0]["_refs"].(map[string]any)
	if !ok || refs["local_asset_id"] == "" || refs["peer_asset_id"] == "" || refs["local_interface_id"] == "" {
		t.Fatalf("链路稳定引用不完整: %#v", links[0]["_refs"])
	}
	preview, err := local.PreflightCmdbSnapshot(localScope, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if preview.UnresolvedReferences != 0 || preview.Conflicts != 0 {
		t.Fatalf("引用完整的快照不应被阻断: %+v", preview)
	}
	if _, err := local.ApplyCmdbSnapshot(localScope, snapshot); err != nil {
		t.Fatal(err)
	}
	var leftName, rightName string
	if err := local.db.QueryRow(`SELECT l.name,r.name FROM cmdb_asset_links link
		JOIN cmdb_assets l ON l.id=link.local_asset_id
		JOIN cmdb_assets r ON r.id=link.peer_asset_id
		WHERE link.project_id=?`, localScope.ProjectID).Scan(&leftName, &rightName); err != nil {
		t.Fatal(err)
	}
	if leftName != "核心交换机" || rightName != "物理服务器" {
		t.Fatalf("跨设备链路引用错误: %s -> %s", leftName, rightName)
	}
}

func TestCmdbMergeRejectsUnknownStableReference(t *testing.T) {
	remote, remoteScope := openSnapshotTestStore(t)
	local, localScope := openSnapshotTestStore(t)
	remoteProject, err := remote.ResolveProject(remoteScope)
	if err != nil {
		t.Fatal(err)
	}
	alignSnapshotProject(t, local, localScope, remoteProject.SyncID)
	assetResult, err := remote.db.Exec(`INSERT INTO cmdb_assets(project_id,name,status) VALUES(?,?,?)`, remoteScope.ProjectID, "服务器", "在用")
	if err != nil {
		t.Fatal(err)
	}
	assetID, _ := assetResult.LastInsertId()
	if _, err := remote.db.Exec(`INSERT INTO cmdb_asset_interfaces(project_id,asset_id,name,ip) VALUES(?,?,?,?)`, remoteScope.ProjectID, assetID, "管理口", "10.20.30.70"); err != nil {
		t.Fatal(err)
	}
	snapshot, err := remote.ExportCmdbSnapshot(remoteScope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	var interfaces []map[string]any
	if err := json.Unmarshal(snapshot.Collections["cmdb_asset_interfaces"], &interfaces); err != nil {
		t.Fatal(err)
	}
	interfaces[0]["_refs"].(map[string]any)["asset_id"] = "00000000-0000-4000-8000-000000000000"
	snapshot.Collections["cmdb_asset_interfaces"], _ = json.Marshal(interfaces)
	snapshot.BaseHash, err = snapshotContentHash(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	preview, err := local.PreflightCmdbSnapshot(localScope, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if preview.UnresolvedReferences != 1 {
		t.Fatalf("未知稳定引用应被预检识别: %+v", preview)
	}
	if _, err := local.ApplyCmdbSnapshot(localScope, snapshot); err == nil {
		t.Fatal("未知引用存在时不得应用快照")
	}
}
