package store

import (
	"path/filepath"
	"strings"
	"testing"
)

func newLegacyAssetTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "legacy_asset_test.db"))
	if err != nil {
		t.Fatalf("打开隔离测试数据库失败: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func createLegacyAsset(t *testing.T, s *Store, a Asset) int64 {
	t.Helper()
	id, err := s.CreateAsset(&a, "测试")
	if err != nil {
		t.Fatalf("创建测试资产失败: %v", err)
	}
	return id
}

func mustLegacyExec(t *testing.T, s *Store, query string, args ...interface{}) {
	t.Helper()
	if _, err := s.db.Exec(query, args...); err != nil {
		t.Fatalf("准备测试数据失败: %v", err)
	}
}

func TestLegacyAssetQueryAndSummaryUseSameArchiveAndFilterRules(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	createLegacyAsset(t, s, Asset{AssetCode: "A-1", UserName: "张三", Department: "执行局", Room: "101", SecuritySoftware: "已安装", Status: "在用"})
	secondID := createLegacyAsset(t, s, Asset{AssetCode: "A-2", UserName: "张三", Department: "执行局", Room: "102", SecuritySoftware: "已安装", Status: "闲置"})
	createLegacyAsset(t, s, Asset{AssetCode: "A-3", UserName: "张三", Department: "执行局", SecuritySoftware: "已安装", Status: "已报废"})
	createLegacyAsset(t, s, Asset{AssetCode: "A-4", UserName: "张三", Department: "执行局", SecuritySoftware: "已安装", Status: "报废"})
	createLegacyAsset(t, s, Asset{AssetCode: "B-1", UserName: "李四", Department: "立案庭", SecuritySoftware: "未安装", Status: "维修中"})

	list, total, err := s.QueryAssetsWithArchived("张三", "执行局", "", "已安装", 1, 1, false)
	if err != nil {
		t.Fatalf("默认查询失败: %v", err)
	}
	if total != 2 || len(list) != 1 || list[0].ID != secondID {
		t.Fatalf("默认应排除两种归档状态且保留分页倒序，total=%d list=%+v", total, list)
	}

	for _, status := range []string{"已报废", "报废"} {
		archived, archivedTotal, err := s.QueryAssetsWithArchived("张三", "执行局", status, "已安装", 1, 20, false)
		if err != nil {
			t.Fatalf("显式筛选 %s 失败: %v", status, err)
		}
		if archivedTotal != 1 || len(archived) != 1 || archived[0].Status != status {
			t.Fatalf("显式筛选 %s 应能查回归档记录，total=%d list=%+v", status, archivedTotal, archived)
		}
	}

	all, allTotal, err := s.QueryAssetsWithArchived("张三", "执行局", "", "已安装", 1, 20, true)
	if err != nil {
		t.Fatalf("包含归档查询失败: %v", err)
	}
	if allTotal != 4 || len(all) != 4 {
		t.Fatalf("includeArchived=true 应保留归档记录，total=%d len=%d", allTotal, len(all))
	}

	summary, err := s.AssetStatusSummary("张三", "执行局", "已安装", false)
	if err != nil {
		t.Fatalf("默认统计失败: %v", err)
	}
	if summary["total"] != 2 || summary["在用"] != 1 || summary["闲置"] != 1 || summary["已报废"] != 0 || summary["报废"] != 0 {
		t.Fatalf("默认统计必须复用列表筛选与归档规则，实际 %+v", summary)
	}
	allSummary, err := s.AssetStatusSummary("张三", "执行局", "已安装", true)
	if err != nil {
		t.Fatalf("包含归档统计失败: %v", err)
	}
	if allSummary["total"] != 4 || allSummary["在用"] != 1 || allSummary["闲置"] != 1 || allSummary["已报废"] != 1 || allSummary["报废"] != 1 {
		t.Fatalf("包含归档统计应按真实状态计数，实际 %+v", allSummary)
	}
}

func TestLegacyAssetGetReturnsRealLogsInReverseOrder(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	id := createLegacyAsset(t, s, Asset{AssetCode: "DETAIL-1", UserName: "张三", Status: "在用"})
	mustLegacyExec(t, s, `INSERT INTO asset_logs (asset_id, log_type, description, log_time) VALUES (?, '信息修改', '第一条', '2026-09-15 10:00:00')`, id)
	mustLegacyExec(t, s, `INSERT INTO asset_logs (asset_id, log_type, description, log_time) VALUES (?, '信息修改', '同时间后写入', '2026-09-15 10:00:00')`, id)
	mustLegacyExec(t, s, `INSERT INTO asset_logs (asset_id, log_type, description, log_time) VALUES (?, '设备维修更换', '最新一条', '2026-09-16 10:00:00')`, id)

	asset, logs, err := s.GetAsset(id)
	if err != nil {
		t.Fatalf("获取详情失败: %v", err)
	}
	if asset.AssetCode != "DETAIL-1" || len(logs) != 3 {
		t.Fatalf("详情或履历不完整: asset=%+v logs=%+v", asset, logs)
	}
	if logs[0].Description != "最新一条" || logs[1].Description != "同时间后写入" || logs[2].Description != "第一条" {
		t.Fatalf("履历应按时间、ID 倒序，实际 %+v", logs)
	}
	if _, _, err := s.GetAsset(id + 999); err == nil {
		t.Fatal("不存在资产必须返回错误")
	}
}

func TestLegacyAssetRelationsOnlyReturnExplicitIPServerAndAppMatches(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	id := createLegacyAsset(t, s, Asset{AssetCode: "REL-1", IP: "10.0.0.10", TerminalIP: "10.0.0.11", Status: "在用"})
	mustLegacyExec(t, s, `INSERT INTO ip_pool (subnet, ip, status) VALUES ('业务网', '10.0.0.10', '已占用'), ('终端网', '10.0.0.11', '已占用'), ('其他', '10.0.0.12', '空闲')`)
	mustLegacyExec(t, s, `INSERT INTO servers (device_name, mgmt_ip, biz_ip, status) VALUES ('管理匹配', '10.0.0.11', '', '运行中'), ('业务匹配', '', '10.0.0.10', '运行中'), ('不匹配', '10.0.0.99', '', '运行中')`)
	mustLegacyExec(t, s, `INSERT INTO server_apps (server_id, app_name, app_type, status) VALUES (1, '应用甲', '业务应用', '正常运行'), (2, '应用乙', '数据库服务', '正常运行'), (3, '无关应用', '业务应用', '正常运行')`)

	relations, err := s.GetAssetRelations(id)
	if err != nil {
		t.Fatalf("获取关联失败: %v", err)
	}
	ips, ok := relations["ips"].([]IPEntry)
	if !ok || len(ips) != 2 {
		t.Fatalf("应固定返回两条明确 IP 关联，实际 %#v", relations["ips"])
	}
	servers, ok := relations["servers"].([]PhysicalServer)
	if !ok || len(servers) != 2 {
		t.Fatalf("应固定返回两条明确服务器关联，实际 %#v", relations["servers"])
	}
	apps, ok := relations["apps"].([]ServerApp)
	if !ok || len(apps) != 2 || apps[0].AppName == "无关应用" || apps[1].AppName == "无关应用" {
		t.Fatalf("应用只能来自明确匹配服务器，实际 %#v", relations["apps"])
	}
	if _, exists := relations["network"]; exists {
		t.Fatalf("关联键应固定为 ips/servers/apps，不能返回旧 network 键: %#v", relations)
	}

	emptyID := createLegacyAsset(t, s, Asset{AssetCode: "REL-EMPTY", Status: "在用"})
	empty, err := s.GetAssetRelations(emptyID)
	if err != nil {
		t.Fatalf("获取空关联失败: %v", err)
	}
	if len(empty["ips"].([]IPEntry)) != 0 || len(empty["servers"].([]PhysicalServer)) != 0 || len(empty["apps"].([]ServerApp)) != 0 {
		t.Fatalf("无明确匹配必须返回空数组，实际 %#v", empty)
	}
	if _, err := s.GetAssetRelations(id + 999); err == nil {
		t.Fatal("不存在资产必须返回错误")
	}
}

func TestLegacyAssetDeleteArchivesAndSynchronizesMappedRecord(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	id := createLegacyAsset(t, s, Asset{AssetCode: "ARCH-1", UserName: "张三", Department: "执行局", Room: "201", Status: "在用"})
	if _, err := s.SyncLegacyToCmdb(); err != nil {
		t.Fatalf("准备 CMDB 映射失败: %v", err)
	}
	if err := s.DeleteAsset(id, "设备到期", "王管理员"); err != nil {
		t.Fatalf("注销归档失败: %v", err)
	}
	asset, logs, err := s.GetAsset(id)
	if err != nil {
		t.Fatalf("注销后原资产必须仍存在: %v", err)
	}
	if asset.Status != "已报废" || len(logs) != 1 {
		t.Fatalf("注销应更新状态并写履历: asset=%+v logs=%+v", asset, logs)
	}
	log := logs[0]
	if log.LogType != "设备回收注销" || log.FromUser != "张三" || log.FromLocation != "执行局 / 201" || log.Operator != "王管理员" || log.Description != "设备到期" {
		t.Fatalf("注销履历未保留完整上下文: %+v", log)
	}
	var mappedStatus string
	if err := s.db.QueryRow(`SELECT status FROM cmdb_assets WHERE source_type='legacy_asset' AND source_id=?`, id).Scan(&mappedStatus); err != nil {
		t.Fatalf("查询 CMDB 映射失败: %v", err)
	}
	if mappedStatus != "报废" {
		t.Fatalf("CMDB 映射状态应同步为报废，实际 %q", mappedStatus)
	}
	if err := s.DeleteAsset(id, "重复", "王管理员"); err == nil {
		t.Fatal("已归档资产再次注销必须返回明确错误")
	}
	if err := s.DeleteAsset(id+999, "不存在", "王管理员"); err == nil {
		t.Fatal("不存在资产注销必须返回错误")
	}
}

func TestLegacyAssetUpdateMissingReturnsError(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	if err := s.UpdateAsset(&Asset{ID: 999, AssetCode: "MISSING", Status: "在用"}, "测试"); err == nil {
		t.Fatal("更新不存在资产时 RowsAffected=0 必须返回错误")
	}
}

func TestLegacyAssetTransferUpdatesLedgerLogAndMappedRecord(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	id := createLegacyAsset(t, s, Asset{AssetCode: "MOVE-1", UserName: "张三", Department: "执行局", Room: "201", IP: "10.0.0.10", Status: "在用"})
	if _, err := s.SyncLegacyToCmdb(); err != nil {
		t.Fatalf("准备 CMDB 映射失败: %v", err)
	}
	req := TransferReq{ToUser: "李四", ToDepartment: "立案庭", ToRoom: "305", NewIP: "10.0.0.20", Date: "2026-09-16 09:30:00", Operator: "王管理员", Description: "岗位调整"}
	if err := s.TransferUser(id, req); err != nil {
		t.Fatalf("调换使用人失败: %v", err)
	}
	asset, logs, err := s.GetAsset(id)
	if err != nil {
		t.Fatalf("读取调换结果失败: %v", err)
	}
	if asset.UserName != "李四" || asset.Department != "立案庭" || asset.Room != "305" || asset.IP != "10.0.0.20" {
		t.Fatalf("主台账未完整更新: %+v", asset)
	}
	if len(logs) != 1 || logs[0].LogType != "调换使用人" || logs[0].FromUser != "张三" || logs[0].ToUser != "李四" || logs[0].FromLocation != "执行局 / 201" || logs[0].ToLocation != "立案庭 / 305" || logs[0].Operator != "王管理员" || logs[0].Description != "岗位调整" || logs[0].LogTime != req.Date {
		t.Fatalf("调换履历不完整: %+v", logs)
	}
	var owner, department, room string
	if err := s.db.QueryRow(`SELECT owner, department, room FROM cmdb_assets WHERE source_type='legacy_asset' AND source_id=?`, id).Scan(&owner, &department, &room); err != nil {
		t.Fatalf("读取 CMDB 映射失败: %v", err)
	}
	if owner != "李四" || department != "立案庭" || room != "305" {
		t.Fatalf("CMDB 映射未同步: owner=%q department=%q room=%q", owner, department, room)
	}

	legacyID := createLegacyAsset(t, s, Asset{AssetCode: "MOVE-OLD", UserName: "旧用户", Department: "原部门", Room: "旧房间", Status: "在用"})
	if err := s.TransferUser(legacyID, TransferReq{ToUser: "新用户", ToLocation: "新房间", Reason: "旧版原因"}); err != nil {
		t.Fatalf("旧 payload 兼容失败: %v", err)
	}
	legacy, legacyLogs, _ := s.GetAsset(legacyID)
	if legacy.Room != "新房间" || legacy.Department != "原部门" || legacyLogs[0].Description != "旧版原因" {
		t.Fatalf("旧 payload 字段未兼容: asset=%+v logs=%+v", legacy, legacyLogs)
	}

	archivedID := createLegacyAsset(t, s, Asset{AssetCode: "MOVE-ARCH", Status: "已报废"})
	if err := s.TransferUser(archivedID, TransferReq{ToUser: "任何人"}); err == nil {
		t.Fatal("归档资产不得调换")
	}
	if err := s.TransferUser(id+999, TransferReq{ToUser: "任何人"}); err == nil {
		t.Fatal("不存在资产不得伪成功")
	}
}

func TestLegacyAssetMaintenanceUpdatesPartsInventoryLogAndMappedRecord(t *testing.T) {
	t.Run("盒子换件并将旧件待修入库", func(t *testing.T) {
		s := newLegacyAssetTestStore(t)
		id := createLegacyAsset(t, s, Asset{AssetCode: "FIX-BOX", BoxSN: "BOX-OLD", DisplaySN: "DISPLAY-KEEP", UserName: "张三", Department: "执行局", Room: "201", Status: "在用"})
		if _, err := s.SyncLegacyToCmdb(); err != nil {
			t.Fatalf("准备 CMDB 映射失败: %v", err)
		}
		req := MaintenanceReq{MaintenanceType: "更换云桌面盒子", PartType: "box", OldSN: "BOX-OLD", NewSN: "BOX-NEW", NewStatus: "在用", MarkOldAs: "故障待修入库", Date: "2026-09-16 11:00:00", Operator: "维修员", Description: "盒子无法启动"}
		if err := s.Maintenance(id, req); err != nil {
			t.Fatalf("盒子换件失败: %v", err)
		}
		asset, logs, _ := s.GetAsset(id)
		if asset.BoxSN != "BOX-NEW" || asset.DisplaySN != "DISPLAY-KEEP" || asset.Status != "在用" {
			t.Fatalf("盒子换件误改或漏改字段: %+v", asset)
		}
		if len(logs) != 1 || logs[0].LogType != "设备维修更换" || logs[0].OldSN != "BOX-OLD" || logs[0].NewSN != "BOX-NEW" || logs[0].Operator != "维修员" || logs[0].Description != "盒子无法启动" || logs[0].LogTime != req.Date {
			t.Fatalf("维修履历不完整: %+v", logs)
		}
		var oldPart Asset
		if err := s.db.QueryRow(`SELECT id, IFNULL(box_sn,''), IFNULL(display_sn,''), IFNULL(status,''), IFNULL(remark,'') FROM assets WHERE id <> ?`, id).Scan(&oldPart.ID, &oldPart.BoxSN, &oldPart.DisplaySN, &oldPart.Status, &oldPart.Remark); err != nil {
			t.Fatalf("旧件未入库: %v", err)
		}
		if oldPart.BoxSN != "BOX-OLD" || oldPart.DisplaySN != "" || oldPart.Status != "维修中" || !strings.Contains(oldPart.Remark, "FIX-BOX") {
			t.Fatalf("旧盒子仓库记录不可追溯: %+v", oldPart)
		}
		var sn, boxSN, status string
		if err := s.db.QueryRow(`SELECT sn, box_sn, status FROM cmdb_assets WHERE source_type='legacy_asset' AND source_id=?`, id).Scan(&sn, &boxSN, &status); err != nil {
			t.Fatalf("读取 CMDB 映射失败: %v", err)
		}
		if sn != "BOX-NEW" || boxSN != "BOX-NEW" || status != "在线" {
			t.Fatalf("CMDB 盒子 SN/状态未同步: sn=%q box_sn=%q status=%q", sn, boxSN, status)
		}
	})

	t.Run("显示器换件并将旧件报废", func(t *testing.T) {
		s := newLegacyAssetTestStore(t)
		id := createLegacyAsset(t, s, Asset{AssetCode: "FIX-DISPLAY", BoxSN: "BOX-KEEP", DisplaySN: "DISPLAY-OLD", Status: "维修中"})
		if _, err := s.SyncLegacyToCmdb(); err != nil {
			t.Fatalf("准备 CMDB 映射失败: %v", err)
		}
		if err := s.Maintenance(id, MaintenanceReq{PartType: "display", OldSN: "DISPLAY-OLD", NewSN: "DISPLAY-NEW", NewStatus: "在用", MarkOldAs: "报废"}); err != nil {
			t.Fatalf("显示器换件失败: %v", err)
		}
		asset, _, _ := s.GetAsset(id)
		if asset.BoxSN != "BOX-KEEP" || asset.DisplaySN != "DISPLAY-NEW" {
			t.Fatalf("显示器换件误改或漏改字段: %+v", asset)
		}
		var oldBox, oldDisplay, oldStatus string
		if err := s.db.QueryRow(`SELECT IFNULL(box_sn,''), IFNULL(display_sn,''), status FROM assets WHERE id <> ?`, id).Scan(&oldBox, &oldDisplay, &oldStatus); err != nil {
			t.Fatalf("读取报废旧件失败: %v", err)
		}
		if oldBox != "" || oldDisplay != "DISPLAY-OLD" || oldStatus != "已报废" {
			t.Fatalf("旧显示器报废记录错误: box=%q display=%q status=%q", oldBox, oldDisplay, oldStatus)
		}
		var mappedDisplay string
		if err := s.db.QueryRow(`SELECT display_sn FROM cmdb_assets WHERE source_type='legacy_asset' AND source_id=?`, id).Scan(&mappedDisplay); err != nil || mappedDisplay != "DISPLAY-NEW" {
			t.Fatalf("CMDB 显示器 SN 未同步: display=%q err=%v", mappedDisplay, err)
		}
	})

	t.Run("其他维修类型不误改序列号且拒绝无效目标", func(t *testing.T) {
		s := newLegacyAssetTestStore(t)
		id := createLegacyAsset(t, s, Asset{AssetCode: "FIX-OTHER", BoxSN: "BOX-KEEP", DisplaySN: "DISPLAY-KEEP", Status: "在用"})
		if err := s.Maintenance(id, MaintenanceReq{MaintenanceType: "整机排障", PartType: "other", OldSN: "IGNORED-OLD", NewSN: "IGNORED-NEW", NewStatus: "维修中", Operator: "维修员"}); err != nil {
			t.Fatalf("整机维修登记失败: %v", err)
		}
		asset, logs, _ := s.GetAsset(id)
		if asset.BoxSN != "BOX-KEEP" || asset.DisplaySN != "DISPLAY-KEEP" || asset.Status != "维修中" || len(logs) != 1 {
			t.Fatalf("其他维修类型不得误改 SN，实际 asset=%+v logs=%+v", asset, logs)
		}
		archivedID := createLegacyAsset(t, s, Asset{AssetCode: "FIX-ARCH", Status: "报废"})
		if err := s.Maintenance(archivedID, MaintenanceReq{PartType: "box", NewSN: "X"}); err == nil {
			t.Fatal("归档资产不得维修")
		}
		if err := s.Maintenance(id+999, MaintenanceReq{PartType: "box", NewSN: "X"}); err == nil {
			t.Fatal("不存在资产不得伪成功")
		}
	})
}

func TestLegacyAssetTransactionsRollbackOnLogFailure(t *testing.T) {
	for _, tc := range []struct {
		name string
		run  func(*Store, int64) error
	}{
		{name: "注销", run: func(s *Store, id int64) error { return s.DeleteAsset(id, "注销原因", "管理员") }},
		{name: "调换", run: func(s *Store, id int64) error {
			return s.TransferUser(id, TransferReq{ToUser: "李四", ToDepartment: "立案庭", ToRoom: "305"})
		}},
		{name: "维修", run: func(s *Store, id int64) error {
			return s.Maintenance(id, MaintenanceReq{PartType: "box", OldSN: "BOX-OLD", NewSN: "BOX-NEW", NewStatus: "维修中", MarkOldAs: "故障待修入库"})
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := newLegacyAssetTestStore(t)
			id := createLegacyAsset(t, s, Asset{AssetCode: "ROLLBACK", BoxSN: "BOX-OLD", UserName: "张三", Department: "执行局", Room: "201", Status: "在用"})
			mustLegacyExec(t, s, `CREATE TRIGGER reject_asset_log BEFORE INSERT ON asset_logs BEGIN SELECT RAISE(ABORT, '拒绝履历写入'); END`)

			if err := tc.run(s, id); err == nil {
				t.Fatal("事务中间失败必须向调用方返回错误")
			}
			asset, logs, err := s.GetAsset(id)
			if err != nil {
				t.Fatalf("回滚后读取资产失败: %v", err)
			}
			if asset.Status != "在用" || asset.UserName != "张三" || asset.Department != "执行局" || asset.Room != "201" || asset.BoxSN != "BOX-OLD" || len(logs) != 0 {
				t.Fatalf("事务失败后主记录或履历未整体回滚: asset=%+v logs=%+v", asset, logs)
			}
			var count int
			if err := s.db.QueryRow(`SELECT COUNT(*) FROM assets`).Scan(&count); err != nil || count != 1 {
				t.Fatalf("维修旧件写入也必须回滚，count=%d err=%v", count, err)
			}
		})
	}
}
