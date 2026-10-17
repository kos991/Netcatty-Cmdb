package store

import (
	"database/sql"
	"errors"
	"os"
	"testing"
)

func insertLegacyRackFixture(t *testing.T, s *Store, scope ProjectScope, room, cabinet, pos string, start int64) int64 {
	t.Helper()
	result, err := s.db.Exec(`INSERT INTO cmdb_assets(project_id,name,status,data_center,cabinet_name,cabinet_pos,start_u,u_start,height_u,u_height,source_type,source_id)
		VALUES(?,?,'在线',?,?,?,?,?,2,2,'legacy_server',(SELECT IFNULL(MAX(source_id),0)+1 FROM cmdb_assets WHERE source_type='legacy_server'))`, scope.ProjectID, "历史服务器", room, cabinet, pos, start, start)
	if err != nil {
		t.Fatal(err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func mustRackPreview(t *testing.T, s *Store, scope ProjectScope) *RackMigrationPreview {
	t.Helper()
	preview, err := s.PreviewRackMigration(scope)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Token == "" {
		t.Fatal("预览必须提供审批 token")
	}
	return preview
}

func TestRackMigrationPreviewApplyBackupIdempotenceAndProjectIsolation(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)
	id := insertLegacyRackFixture(t, s, scopeA, "", "2楼数据中心机房 (1－1机柜)", "", 44)
	otherID := insertLegacyRackFixture(t, s, scopeB, "", "2楼数据中心机房 (1－1机柜)", "", 44)
	roomID := insertLegacyRackFixture(t, s, scopeA, "", "科技法庭核心机房", "", 0)
	explicitID := insertLegacyRackFixture(t, s, scopeA, "数据中心机房", "", "", 0)
	result, err := s.db.Exec(`INSERT INTO cmdb_locations(project_id,name,rack_units) VALUES(?,?,47)`, scopeA.ProjectID, "2楼数据中心机房 (1-1机柜)")
	if err != nil {
		t.Fatal(err)
	}
	locationID, _ := result.LastInsertId()
	before, _, err := s.GetCmdbAssetForProject(scopeA, id)
	if err != nil {
		t.Fatal(err)
	}
	var beforeRevision int64
	if err := s.db.QueryRow("SELECT revision FROM cmdb_assets WHERE id=?", id).Scan(&beforeRevision); err != nil {
		t.Fatal(err)
	}
	preview := mustRackPreview(t, s, scopeA)
	if preview.Total != 2 || len(preview.Conflicts) != 0 || preview.RollbackAvailable {
		t.Fatalf("预览未正确识别机房/机柜: %+v", preview)
	}
	untouched, _, err := s.GetCmdbAssetForProject(scopeA, id)
	if err != nil || untouched.CabinetName != before.CabinetName || untouched.UpdatedAt != before.UpdatedAt {
		t.Fatalf("预览不得修改资料: %+v %v", untouched, err)
	}
	applied, err := s.ApplyRackMigration(scopeA, preview.Token)
	if err != nil || applied.Updated != 2 || applied.BackupPath == "" {
		t.Fatalf("迁移失败: %+v %v", applied, err)
	}
	if _, err := os.Stat(applied.BackupPath); err != nil {
		t.Fatal(err)
	}
	backup, err := sql.Open("sqlite", applied.BackupPath)
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	var backedUpCabinet string
	if err := backup.QueryRow("SELECT cabinet_name FROM cmdb_assets WHERE id=?", id).Scan(&backedUpCabinet); err != nil || backedUpCabinet != before.CabinetName {
		t.Fatalf("完整备份未保留迁移前资料: %s %v", backedUpCabinet, err)
	}
	got, _, err := s.GetCmdbAssetForProject(scopeA, id)
	if err != nil || got.DataCenter != "2楼数据中心机房" || got.CabinetName != "1-1机柜" || got.CabinetPos != "" || got.StartU != 44 || got.UStart != 44 || got.HeightU != 2 || got.UHeight != 2 {
		t.Fatalf("机柜迁移丢失位置/U 位: %+v %v", got, err)
	}
	var afterRevision int64
	if err := s.db.QueryRow("SELECT revision FROM cmdb_assets WHERE id=?", id).Scan(&afterRevision); err != nil {
		t.Fatal(err)
	}
	if got.ID != before.ID || got.ProjectID != before.ProjectID || got.SyncID != before.SyncID || got.SourceID != before.SourceID || got.SourceType != before.SourceType || afterRevision <= beforeRevision {
		t.Fatalf("迁移破坏资产身份或修订: before=%+v after=%+v", before, got)
	}
	roomOnly, _, _ := s.GetCmdbAssetForProject(scopeA, roomID)
	if roomOnly.DataCenter != "科技法庭核心机房" || roomOnly.CabinetName != "" {
		t.Fatalf("仅机房记录不得变成机柜: %+v", roomOnly)
	}
	explicit, _, _ := s.GetCmdbAssetForProject(scopeA, explicitID)
	if explicit.DataCenter != "数据中心机房" || explicit.CabinetName != "" {
		t.Fatalf("现有明确机房不得推测合并: %+v", explicit)
	}
	other, _, _ := s.GetCmdbAssetForProject(scopeB, otherID)
	if other.CabinetName != "2楼数据中心机房 (1－1机柜)" || other.DataCenter != "" {
		t.Fatalf("不得迁移其他项目: %+v", other)
	}
	var name string
	var units int64
	if err := s.db.QueryRow("SELECT name,rack_units FROM cmdb_locations WHERE id=?", locationID).Scan(&name, &units); err != nil || name != "2楼数据中心机房 (1-1机柜)" || units != 47 {
		t.Fatalf("47U 高度目录丢失: %s %d %v", name, units, err)
	}
	second := mustRackPreview(t, s, scopeA)
	if second.Total != 0 || !second.RollbackAvailable {
		t.Fatalf("迁移不是幂等: %+v", second)
	}
	rerun, err := s.ApplyRackMigration(scopeA, second.Token)
	if err != nil || rerun.Updated != 0 || rerun.BackupPath != "" {
		t.Fatalf("重复迁移应为空操作: %+v %v", rerun, err)
	}
}

func TestRackMigrationRejectsAmbiguousRoomAndLeavesEntireBatchUntouched(t *testing.T) {
	for _, fixture := range []struct{ room, cabinet, pos string }{
		{"另一个机房", "2楼数据中心机房 (1-1机柜)", ""},
		{"", "2楼数据中心机房 (1-1机柜) (备注)", ""},
		{"", "2楼数据中心机房 (设备区)", ""},
		{"", "", "东区位置不明"},
		{"机房A", "1-1机柜", "2-2机柜"},
	} {
		t.Run(fixture.room+fixture.cabinet+fixture.pos, func(t *testing.T) {
			s := newCmdbTestStore(t)
			scope, _ := s.DefaultProjectScope()
			goodID := insertLegacyRackFixture(t, s, scope, "", "科技法庭核心机房", "", 0)
			badID := insertLegacyRackFixture(t, s, scope, fixture.room, fixture.cabinet, fixture.pos, 0)
			preview := mustRackPreview(t, s, scope)
			if len(preview.Conflicts) != 1 || preview.Conflicts[0].ID != badID {
				t.Fatalf("必须显式报告歧义: %+v", preview)
			}
			if _, err := s.ApplyRackMigration(scope, preview.Token); !errors.Is(err, ErrRackMigrationConflict) {
				t.Fatalf("歧义批次必须拒绝: %v", err)
			}
			good, _, _ := s.GetCmdbAssetForProject(scope, goodID)
			if good.CabinetName != "科技法庭核心机房" || good.DataCenter != "" {
				t.Fatalf("失败批次不得部分写入: %+v", good)
			}
		})
	}
}

func TestRackMigrationPreservesAndQualifiesLegacy47URegistry(t *testing.T) {
	for _, name := range []string{"2楼数据中心机房（２－３机柜）", "2－3机柜"} {
		t.Run(name, func(t *testing.T) {
			s := newCmdbTestStore(t)
			scope, _ := s.DefaultProjectScope()
			insertLegacyRackFixture(t, s, scope, "", "2楼数据中心机房 (2－3机柜)", "", 45)
			_, err := s.db.Exec("INSERT INTO cmdb_locations(project_id,name,rack_units) VALUES(?,?,47)", scope.ProjectID, name)
			if err != nil {
				t.Fatal(err)
			}
			preview := mustRackPreview(t, s, scope)
			if len(preview.Locations) != 1 || len(preview.Conflicts) != 0 {
				t.Fatalf("高度目录迁移应出现在预览: %+v", preview)
			}
			if _, err := s.ApplyRackMigration(scope, preview.Token); err != nil {
				t.Fatal(err)
			}
			var units int64
			if err := s.db.QueryRow("SELECT rack_units FROM cmdb_locations WHERE project_id=? AND name=?", scope.ProjectID, "2楼数据中心机房 (2-3机柜)").Scan(&units); err != nil || units != 47 {
				t.Fatalf("规范化不应丢失47U: %d %v", units, err)
			}
			if _, err := s.RollbackRackMigration(scope); err != nil {
				t.Fatal(err)
			}
			if err := s.db.QueryRow("SELECT rack_units FROM cmdb_locations WHERE project_id=? AND name=?", scope.ProjectID, name).Scan(&units); err != nil || units != 47 {
				t.Fatalf("回滚应恢复原目录名和47U: %d %v", units, err)
			}
		})
	}
}

func TestRackMigrationRefusesAmbiguousOrDuplicateHeightRegistry(t *testing.T) {
	for _, duplicate := range []bool{false, true} {
		s := newCmdbTestStore(t)
		scope, _ := s.DefaultProjectScope()
		insertLegacyRackFixture(t, s, scope, "", "甲机房 (1-1机柜)", "", 3)
		name := "1-1机柜"
		if duplicate {
			name = "甲机房（1－1机柜）"
			if _, err := s.db.Exec("INSERT INTO cmdb_locations(project_id,name,rack_units) VALUES(?,?,42)", scope.ProjectID, "甲机房 (1-1机柜)"); err != nil {
				t.Fatal(err)
			}
		} else {
			insertLegacyRackFixture(t, s, scope, "", "乙机房 (1-1机柜)", "", 3)
		}
		if _, err := s.db.Exec("INSERT INTO cmdb_locations(project_id,name,rack_units) VALUES(?,?,47)", scope.ProjectID, name); err != nil {
			t.Fatal(err)
		}
		preview := mustRackPreview(t, s, scope)
		if len(preview.Conflicts) == 0 {
			t.Fatalf("不能猜测或合并高度: %+v", preview)
		}
		if _, err := s.ApplyRackMigration(scope, preview.Token); !errors.Is(err, ErrRackMigrationConflict) {
			t.Fatalf("高度冲突必须拒绝: %v", err)
		}
	}
}

func TestRackMigrationRejectsStaleApprovalAndCrossProjectToken(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)
	id := insertLegacyRackFixture(t, s, scopeA, "", "甲机房 (1-1机柜)", "", 3)
	insertLegacyRackFixture(t, s, scopeB, "", "甲机房 (1-1机柜)", "", 3)
	preview := mustRackPreview(t, s, scopeA)
	if _, err := s.ApplyRackMigration(scopeB, preview.Token); !errors.Is(err, ErrRackMigrationConflict) {
		t.Fatalf("审批 token 不得跨项目使用: %v", err)
	}
	if _, err := s.db.Exec("UPDATE cmdb_assets SET remark='用户的新备注' WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ApplyRackMigration(scopeA, preview.Token); !errors.Is(err, ErrRackMigrationConflict) {
		t.Fatalf("任意较新改动均使预览过期: %v", err)
	}
	got, _, _ := s.GetCmdbAssetForProject(scopeA, id)
	if got.CabinetName != "甲机房 (1-1机柜)" || got.Remark != "用户的新备注" {
		t.Fatalf("过期审批不得修改资产: %+v", got)
	}
}

func TestRackMigrationRollbackSurvivesRestartAndPreservesUnrelatedNewEdits(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	id := insertLegacyRackFixture(t, s, scope, "", "甲机房 (1－1机柜)", "", 44)
	unrelatedID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "无关设备", DataCenter: "乙机房", CabinetName: "A01"})
	if err != nil {
		t.Fatal(err)
	}
	preview := mustRackPreview(t, s, scope)
	if _, err := s.ApplyRackMigration(scope, preview.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("UPDATE cmdb_assets SET remark='迁移后的无关改动' WHERE id=?", unrelatedID); err != nil {
		t.Fatal(err)
	}
	path := s.path
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if !mustRackPreview(t, reopened, scope).RollbackAvailable {
		t.Fatal("重启后必须保留选择性回滚")
	}
	updated, err := reopened.RollbackRackMigration(scope)
	if err != nil || updated != 1 {
		t.Fatalf("回滚失败: %d %v", updated, err)
	}
	got, _, _ := reopened.GetCmdbAssetForProject(scope, id)
	if got.CabinetName != "甲机房 (1－1机柜)" || got.DataCenter != "" || got.StartU != 44 || got.UStart != 44 {
		t.Fatalf("回滚未恢复位置/U位: %+v", got)
	}
	unrelated, _, _ := reopened.GetCmdbAssetForProject(scope, unrelatedID)
	if unrelated.Remark != "迁移后的无关改动" {
		t.Fatalf("选择性回滚覆盖了无关新资料: %+v", unrelated)
	}
	if mustRackPreview(t, reopened, scope).RollbackAvailable {
		t.Fatal("回滚后不得重复回滚")
	}
}

func TestRackMigrationRollbackRefusesNewerAssetOrHeightChangesWithoutPartialWrites(t *testing.T) {
	for _, table := range []string{"cmdb_assets", "cmdb_locations"} {
		t.Run(table, func(t *testing.T) {
			s := newCmdbTestStore(t)
			scope, _ := s.DefaultProjectScope()
			firstID := insertLegacyRackFixture(t, s, scope, "", "甲机房 (1－1机柜)", "", 3)
			secondID := insertLegacyRackFixture(t, s, scope, "", "甲机房 (1－1机柜)", "", 10)
			result, err := s.db.Exec("INSERT INTO cmdb_locations(project_id,name,rack_units) VALUES(?,?,47)", scope.ProjectID, "甲机房（1－1机柜）")
			if err != nil {
				t.Fatal(err)
			}
			locationID, _ := result.LastInsertId()
			preview := mustRackPreview(t, s, scope)
			if _, err := s.ApplyRackMigration(scope, preview.Token); err != nil {
				t.Fatal(err)
			}
			if table == "cmdb_assets" {
				_, err = s.db.Exec("UPDATE cmdb_assets SET remark='新编辑' WHERE id=?", secondID)
			} else {
				_, err = s.db.Exec("UPDATE cmdb_locations SET rack_units=48 WHERE id=?", locationID)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.RollbackRackMigration(scope); !errors.Is(err, ErrRackMigrationConflict) {
				t.Fatalf("回滚不得覆盖新改动: %v", err)
			}
			first, _, _ := s.GetCmdbAssetForProject(scope, firstID)
			if first.DataCenter != "甲机房" || first.CabinetName != "1-1机柜" {
				t.Fatalf("回滚失败不得部分恢复: %+v", first)
			}
		})
	}
}
