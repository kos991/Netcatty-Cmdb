package store

import (
	"database/sql"
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

func TestLegacyAssetNameRoundTripAndActualFilters(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	var assetNameColumn int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('assets') WHERE name='asset_name'`).Scan(&assetNameColumn); err != nil {
		t.Fatal(err)
	}
	if assetNameColumn != 1 {
		t.Fatalf("assets 表必须迁移独立资产名称列，实际=%d", assetNameColumn)
	}

	matchingID := createLegacyAsset(t, s, Asset{
		AssetName: "执行局办公终端", AssetCode: "PC-100", DeviceType: "台式电脑",
		UserName: "张三", Department: "执行局", Room: "502室", IP: "10.20.30.100",
		NetType: "内网", OSType: "统信 UOS", Status: "在用",
	})
	createLegacyAsset(t, s, Asset{
		AssetName: "办公室备用终端", AssetCode: "PC-101", DeviceType: "台式电脑",
		UserName: "李四", Department: "办公室", Room: "仓库", IP: "10.20.30.101",
		NetType: "专网", OSType: "Windows 11", Status: "闲置",
	})

	asset, _, err := s.GetAssetForProject(scope, matchingID)
	if err != nil {
		t.Fatal(err)
	}
	if asset.AssetName != "执行局办公终端" {
		t.Fatalf("资产名称未往返保存: %+v", asset)
	}
	asset.AssetName = "执行局审判终端"
	if err := s.UpdateAssetForProject(scope, asset, "测试"); err != nil {
		t.Fatal(err)
	}

	list, total, err := s.QueryAssetsForProject(scope, AssetQuery{
		Keyword: "审判终端", DeviceType: "台式电脑", Department: "执行局",
		UserName: "张三", Room: "502室", NetType: "内网", OSType: "统信 UOS",
		Status: "在用", GroupID: -1, Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(list) != 1 || list[0].ID != matchingID || list[0].AssetName != "执行局审判终端" {
		t.Fatalf("终端实际筛选未按交集返回: total=%d list=%+v", total, list)
	}
}

func TestLegacyAssetUnsetFiltersAndIPAMNetworkTypes(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "设备网", Category: "政法专网", CIDR: "10.20.31.0/24"}); err != nil {
		t.Fatal(err)
	}
	matchedID := createLegacyAsset(t, s, Asset{
		AssetName: "已纳管终端", IP: "10.20.31.10", TerminalIP: "10.20.31.11",
		Status: "在用", NetType: "", GroupID: 0,
	})
	createLegacyAsset(t, s, Asset{
		AssetName: "已分类终端", DeviceType: "笔记本", IP: "10.20.31.12", NetType: "内网", Status: "在用",
	})
	unconfiguredNetworkID := createLegacyAsset(t, s, Asset{
		AssetName: "未配置网络终端", DeviceType: "台式电脑", Status: "在用",
	})

	list, total, err := s.QueryAssetsForProject(scope, AssetQuery{
		DeviceType: AssetUnconfiguredFilter, GroupID: -1, Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(list) != 1 || list[0].ID != matchedID {
		t.Fatalf("未配置分类和未分组筛选必须取交集: total=%d list=%+v", total, list)
	}
	if list[0].IPNetworkType != "政法专网" || list[0].TerminalIPNetworkType != "政法专网" {
		t.Fatalf("资产 IP 网络类型应来自匹配的 IPAM 网段: %+v", list[0])
	}
	unconfigured, total, err := s.QueryAssetsForProject(scope, AssetQuery{
		DeviceType: "台式电脑", NetType: AssetUnconfiguredFilter, GroupID: -1, Page: 1, PageSize: 20,
	})
	if err != nil || total != 1 || len(unconfigured) != 1 || unconfigured[0].ID != unconfiguredNetworkID {
		t.Fatalf("未配置网络筛选必须排除 IPAM 已识别网段: total=%d list=%+v err=%v", total, unconfigured, err)
	}
}

func TestLegacyCloudDesktopResolvesBusinessIPFromIPAMBoxRemark(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateIPSubnetForProject(scope, &IPSubnet{Name: "外网", Category: "外网", CIDR: "191.162.17.0/24"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAssetForProject(scope, &Asset{AssetCode: "CLOUD-001", DeviceType: "云桌面终端", IP: "外网", TerminalIP: "180.161.30.63"}, "测试"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateIPEntryForProject(scope, &IPEntry{Subnet: "外网", IP: "191.162.17.63", Remark: "外网云桌面｜盒子 180.161.30.63"}); err != nil {
		t.Fatal(err)
	}
	assets, err := s.AllAssetsForProject(scope)
	if err != nil {
		t.Fatal(err)
	}
	if len(assets) != 1 || assets[0].IP != "191.162.17.63" || assets[0].IPNetworkType != "外网" {
		t.Fatalf("云桌面业务 IP 未从 IPAM 备注恢复: %+v", assets)
	}
}

func TestImportAssetsForProjectRollsBackOnIPConflict(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	err = s.ImportAssetsForProject(scope, []Asset{
		{AssetCode: "IMPORT-1", DeviceType: "台式电脑", IP: "10.20.30.80", Status: "在用"},
		{AssetCode: "IMPORT-2", DeviceType: "台式电脑", IP: "10.20.30.80", Status: "在用"},
	})
	if err == nil || !strings.Contains(err.Error(), "已关联其他资产") {
		t.Fatalf("expected IP conflict, got %v", err)
	}
	assets, err := s.AllAssetsForProject(scope)
	if err != nil {
		t.Fatal(err)
	}
	if len(assets) != 0 {
		t.Fatalf("partial import was not rolled back: %#v", assets)
	}
}

func mustLegacyExec(t *testing.T, s *Store, query string, args ...interface{}) {
	t.Helper()
	if _, err := s.db.Exec(query, args...); err != nil {
		t.Fatalf("准备测试数据失败: %v", err)
	}
}

func TestLegacyAssetDeviceTypeRoundTripAndMaintenanceInheritance(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	id := createLegacyAsset(t, s, Asset{
		AssetCode: "TYPE-1", DeviceType: "云桌面终端", BoxSN: "BOX-OLD", Status: "在用",
	})

	asset, _, err := s.GetAsset(id)
	if err != nil {
		t.Fatalf("读取设备类型失败: %v", err)
	}
	if asset.DeviceType != "云桌面终端" {
		t.Fatalf("新增后设备类型未保存: %+v", asset)
	}
	asset.DeviceType = "台式电脑"
	if err := s.UpdateAsset(asset, "测试"); err != nil {
		t.Fatalf("更新设备类型失败: %v", err)
	}
	updated, _, err := s.GetAsset(id)
	if err != nil || updated.DeviceType != "台式电脑" {
		t.Fatalf("更新后设备类型未保存: asset=%+v err=%v", updated, err)
	}

	if err := s.Maintenance(id, MaintenanceReq{
		PartType: "box", OldSN: "BOX-OLD", NewSN: "BOX-NEW",
		NewStatus: "在用", MarkOldAs: "故障待修入库",
	}); err != nil {
		t.Fatalf("维修换件失败: %v", err)
	}
	var oldPartType string
	if err := s.db.QueryRow(`SELECT IFNULL(device_type,'') FROM assets WHERE id <> ?`, id).Scan(&oldPartType); err != nil {
		t.Fatalf("读取旧件设备类型失败: %v", err)
	}
	if oldPartType != "台式电脑" {
		t.Fatalf("维修旧件未继承设备类型: %q", oldPartType)
	}
}

func TestLegacyAssetOperatingSystemRoundTripSearchAndMappedUpdate(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	id := createLegacyAsset(t, s, Asset{
		AssetCode: "OS-PC-1", DeviceType: "台式电脑", OSType: "统信 UOS", OSVersion: "20 1070e", Status: "在用",
	})

	asset, _, err := s.GetAsset(id)
	if err != nil {
		t.Fatalf("读取终端系统信息失败: %v", err)
	}
	if asset.OSType != "统信 UOS" || asset.OSVersion != "20 1070e" {
		t.Fatalf("新增后系统信息未保存: %+v", asset)
	}
	found, total, err := s.QueryAssetsWithArchived("1070e", "", "", "", 1, 20, false)
	if err != nil || total != 1 || len(found) != 1 || found[0].ID != id {
		t.Fatalf("系统版本关键词应能检索终端: list=%+v total=%d err=%v", found, total, err)
	}
	global, err := s.GlobalSearch("统信 UOS", 20)
	if err != nil || len(global) != 1 || global[0].ID != id || global[0].TableKey != "assets" {
		t.Fatalf("设备资产顶部搜索应能按系统类型找到终端: results=%+v err=%v", global, err)
	}

	if _, err := s.SyncLegacyToCmdb(); err != nil {
		t.Fatalf("准备终端 CMDB 映射失败: %v", err)
	}
	asset.OSType = "银河麒麟"
	asset.OSVersion = "V10 SP3"
	if err := s.UpdateAsset(asset, "测试"); err != nil {
		t.Fatalf("更新终端系统信息失败: %v", err)
	}
	updated, _, err := s.GetAsset(id)
	if err != nil || updated.OSType != "银河麒麟" || updated.OSVersion != "V10 SP3" {
		t.Fatalf("更新后系统信息未保存: asset=%+v err=%v", updated, err)
	}
	var mappedType, mappedVersion string
	if err := s.db.QueryRow(`SELECT IFNULL(os_type,''), IFNULL(os_version,'') FROM cmdb_assets WHERE source_type='legacy_asset' AND source_id=?`, id).Scan(&mappedType, &mappedVersion); err != nil {
		t.Fatalf("读取终端 CMDB 映射系统信息失败: %v", err)
	}
	if mappedType != "银河麒麟" || mappedVersion != "V10 SP3" {
		t.Fatalf("终端系统信息未同步到 CMDB 映射: type=%q version=%q", mappedType, mappedVersion)
	}
}

func TestLegacyAssetAttributeUpdateKeepsExistingAddressBindings(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	firstID := createLegacyAsset(t, s, Asset{AssetCode: "OLD-1", DeviceType: "云桌面终端", IP: "10.20.30.21", Status: "在用"})
	secondID := createLegacyAsset(t, s, Asset{AssetCode: "OLD-2", DeviceType: "云桌面终端", Status: "在用"})
	// 历史导入的数据可能把网络类型文字填在 IP 列，普通属性编辑不能重分配该值。
	mustLegacyExec(t, s, `UPDATE assets SET ip='外网' WHERE id IN (?,?)`, firstID, secondID)
	for _, id := range []int64{firstID, secondID} {
		asset, _, err := s.GetAsset(id)
		if err != nil {
			t.Fatal(err)
		}
		asset.OSType = "统信 UOS"
		asset.DeviceType = "云桌面盒子"
		if err := s.UpdateAsset(asset, "测试"); err != nil {
			t.Fatalf("修改分类和系统不应重校验未改变的历史 IP: %v", err)
		}
		updated, _, err := s.GetAsset(id)
		if err != nil || updated.IP != "外网" || updated.OSType != "统信 UOS" || updated.DeviceType != "云桌面盒子" {
			t.Fatalf("属性未保存或历史 IP 被改动: asset=%+v err=%v", updated, err)
		}
	}
}

func TestLegacyAssetSerialFieldsFollowDeviceType(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	ordinaryID := createLegacyAsset(t, s, Asset{
		AssetCode: "SERIAL-PC", DeviceType: "台式电脑", BoxSN: "PC-SN-1", DisplaySN: "DISPLAY-OLD", TerminalIP: "10.20.30.21", Status: "在用",
	})
	ordinary, _, err := s.GetAsset(ordinaryID)
	if err != nil {
		t.Fatal(err)
	}
	if ordinary.BoxSN != "PC-SN-1" || ordinary.DisplaySN != "" || ordinary.TerminalIP != "" {
		t.Fatalf("普通终端只应保留设备 SN: %+v", ordinary)
	}
	if err := s.Maintenance(ordinaryID, MaintenanceReq{PartType: "display", NewSN: "DISPLAY-NEW", NewStatus: "在用"}); err == nil || !strings.Contains(err.Error(), "仅云桌面") {
		t.Fatalf("普通终端不应允许显示器换件，实际错误=%v", err)
	}

	cloudID := createLegacyAsset(t, s, Asset{
		AssetCode: "SERIAL-CLOUD", DeviceType: "云桌面盒子", BoxSN: "BOX-SN-1", DisplaySN: "DISPLAY-SN-1", TerminalIP: "10.20.30.22", Status: "在用",
	})
	cloud, _, err := s.GetAsset(cloudID)
	if err != nil {
		t.Fatal(err)
	}
	if cloud.DisplaySN != "DISPLAY-SN-1" || cloud.TerminalIP != "10.20.30.22" {
		t.Fatalf("云桌面应保留双 SN 和终端物理 IP: %+v", cloud)
	}
}

func TestLegacyAssetDeviceTypeMigrationBackfillsExistingRows(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy_device_type.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("创建旧数据库失败: %v", err)
	}
	_, err = db.Exec(`
		CREATE TABLE assets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id INTEGER DEFAULT 1,
			asset_code TEXT, box_sn TEXT, display_sn TEXT, user_name TEXT,
			department TEXT, room TEXT, ip TEXT, terminal_ip TEXT,
			security_software TEXT, status TEXT, net_type TEXT, remark TEXT,
			created_at TEXT, updated_at TEXT
		);
		INSERT INTO assets (project_id, asset_code, box_sn, status) VALUES (1, 'OLD-1', 'BOX-1', '在用');
	`)
	if err != nil {
		_ = db.Close()
		t.Fatalf("准备旧数据库失败: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("关闭旧数据库失败: %v", err)
	}

	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("迁移旧数据库失败: %v", err)
	}
	defer s.Close()
	var deviceType, osType, osVersion string
	if err := s.db.QueryRow(`SELECT IFNULL(device_type,''), IFNULL(os_type,''), IFNULL(os_version,'') FROM assets WHERE asset_code='OLD-1'`).Scan(&deviceType, &osType, &osVersion); err != nil {
		t.Fatalf("读取迁移结果失败: %v", err)
	}
	if deviceType != "" || osType != "" || osVersion != "" {
		t.Fatalf("旧终端资产未知字段不应臆造，device_type=%q os_type=%q os_version=%q", deviceType, osType, osVersion)
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

func TestLegacyAssetExportFilterUsesListArchiveAndKeywordRules(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	createLegacyAsset(t, s, Asset{AssetCode: "EXPORT-ACTIVE", TerminalIP: "10.20.30.41", Status: "在用"})
	createLegacyAsset(t, s, Asset{AssetCode: "EXPORT-ARCHIVED", TerminalIP: "10.20.30.42", Status: "已报废"})

	active, err := s.AllAssetsFiltered("10.20.30", "", "", "", false)
	if err != nil {
		t.Fatalf("默认导出筛选失败: %v", err)
	}
	if len(active) != 1 || active[0].AssetCode != "EXPORT-ACTIVE" {
		t.Fatalf("默认导出必须支持 terminal_ip 关键词并排除归档，实际 %+v", active)
	}
	archived, err := s.AllAssetsFiltered("10.20.30", "", "已报废", "", false)
	if err != nil {
		t.Fatalf("显式归档导出筛选失败: %v", err)
	}
	if len(archived) != 1 || archived[0].AssetCode != "EXPORT-ARCHIVED" {
		t.Fatalf("显式归档状态必须可导出，实际 %+v", archived)
	}
	all, err := s.AllAssetsFiltered("10.20.30", "", "", "", true)
	if err != nil {
		t.Fatalf("包含归档导出筛选失败: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("includeArchived=true 应导出全部匹配记录，实际 %+v", all)
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
	t.Run("终端主机换件并将旧件待修入库", func(t *testing.T) {
		s := newLegacyAssetTestStore(t)
		id := createLegacyAsset(t, s, Asset{AssetCode: "FIX-BOX", BoxSN: "BOX-OLD", DisplaySN: "DISPLAY-KEEP", UserName: "张三", Department: "执行局", Room: "201", Status: "在用"})
		if _, err := s.SyncLegacyToCmdb(); err != nil {
			t.Fatalf("准备 CMDB 映射失败: %v", err)
		}
		req := MaintenanceReq{MaintenanceType: "更换终端主机", PartType: "box", OldSN: "BOX-OLD", NewSN: "BOX-NEW", NewStatus: "在用", MarkOldAs: "故障待修入库", Date: "2026-09-16 11:00:00", Operator: "维修员", Description: "终端主机无法启动"}
		if err := s.Maintenance(id, req); err != nil {
			t.Fatalf("终端主机换件失败: %v", err)
		}
		asset, logs, _ := s.GetAsset(id)
		if asset.BoxSN != "BOX-NEW" || asset.DisplaySN != "DISPLAY-KEEP" || asset.Status != "在用" {
			t.Fatalf("终端主机换件误改或漏改字段: %+v", asset)
		}
		if len(logs) != 1 || logs[0].LogType != "设备维修更换" || logs[0].OldSN != "BOX-OLD" || logs[0].NewSN != "BOX-NEW" || logs[0].Operator != "维修员" || logs[0].Description != "终端主机无法启动" || logs[0].LogTime != req.Date {
			t.Fatalf("维修履历不完整: %+v", logs)
		}
		var oldPart Asset
		if err := s.db.QueryRow(`SELECT id, IFNULL(box_sn,''), IFNULL(display_sn,''), IFNULL(status,''), IFNULL(remark,'') FROM assets WHERE id <> ?`, id).Scan(&oldPart.ID, &oldPart.BoxSN, &oldPart.DisplaySN, &oldPart.Status, &oldPart.Remark); err != nil {
			t.Fatalf("旧件未入库: %v", err)
		}
		if oldPart.BoxSN != "BOX-OLD" || oldPart.DisplaySN != "" || oldPart.Status != "维修中" || !strings.Contains(oldPart.Remark, "FIX-BOX") {
			t.Fatalf("旧终端主机仓库记录不可追溯: %+v", oldPart)
		}
		var sn, boxSN, status string
		if err := s.db.QueryRow(`SELECT sn, box_sn, status FROM cmdb_assets WHERE source_type='legacy_asset' AND source_id=?`, id).Scan(&sn, &boxSN, &status); err != nil {
			t.Fatalf("读取 CMDB 映射失败: %v", err)
		}
		if sn != "BOX-NEW" || boxSN != "BOX-NEW" || status != "在线" {
			t.Fatalf("Cmdb 终端主机 SN/状态未同步: sn=%q box_sn=%q status=%q", sn, boxSN, status)
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

func TestLegacyAssetMaintenanceRejectsStaleAndDuplicatePartRequests(t *testing.T) {
	t.Run("页面旧SN为空但库中已变非空时拒绝且不写入", func(t *testing.T) {
		s := newLegacyAssetTestStore(t)
		id := createLegacyAsset(t, s, Asset{AssetCode: "STALE-EMPTY", BoxSN: "", Status: "在用"})
		mustLegacyExec(t, s, `UPDATE assets SET box_sn='BOX-CURRENT' WHERE id=?`, id)

		err := s.Maintenance(id, MaintenanceReq{
			PartType: "box", OldSN: "", NewSN: "BOX-NEW",
			NewStatus: "维修中", MarkOldAs: "故障待修入库", Description: "空快照陈旧提交",
		})
		if err == nil || !strings.Contains(err.Error(), "旧SN") {
			t.Fatalf("页面空 old_sn 与当前非空 SN 不一致时必须报错，实际 %v", err)
		}
		asset, logs, getErr := s.GetAsset(id)
		if getErr != nil {
			t.Fatalf("读取拒绝后的资产失败: %v", getErr)
		}
		if asset.BoxSN != "BOX-CURRENT" || asset.Status != "在用" || len(logs) != 0 {
			t.Fatalf("空快照陈旧请求不得更新主表或履历: asset=%+v logs=%+v", asset, logs)
		}
		assets, listErr := s.AllAssets()
		if listErr != nil || len(assets) != 1 {
			t.Fatalf("空快照陈旧请求不得生成旧件: assets=%+v err=%v", assets, listErr)
		}
	})

	t.Run("陈旧旧SN不写主表旧件或履历", func(t *testing.T) {
		s := newLegacyAssetTestStore(t)
		id := createLegacyAsset(t, s, Asset{AssetCode: "STALE-BOX", BoxSN: "BOX-CURRENT", Status: "在用"})
		err := s.Maintenance(id, MaintenanceReq{
			PartType: "box", OldSN: "BOX-STALE", NewSN: "BOX-NEW",
			NewStatus: "维修中", MarkOldAs: "故障待修入库", Description: "陈旧页面提交",
		})
		if err == nil || !strings.Contains(err.Error(), "旧SN") {
			t.Fatalf("陈旧 old_sn 必须返回明确错误，实际 %v", err)
		}
		asset, logs, getErr := s.GetAsset(id)
		if getErr != nil {
			t.Fatalf("读取拒绝后的资产失败: %v", getErr)
		}
		if asset.BoxSN != "BOX-CURRENT" || asset.Status != "在用" || len(logs) != 0 {
			t.Fatalf("陈旧请求不得写入任何资产或履历变化: asset=%+v logs=%+v", asset, logs)
		}
		assets, err := s.AllAssets()
		if err != nil || len(assets) != 1 {
			t.Fatalf("陈旧请求不得生成旧件，assets=%+v err=%v", assets, err)
		}
	})

	t.Run("重复提交不生成重复旧件或履历且后续维修编码唯一", func(t *testing.T) {
		s := newLegacyAssetTestStore(t)
		id := createLegacyAsset(t, s, Asset{AssetCode: "REPAIR-BOX", BoxSN: "BOX-001", Status: "在用"})
		first := MaintenanceReq{
			PartType: "box", OldSN: "BOX-001", NewSN: "BOX-002",
			NewStatus: "在用", MarkOldAs: "故障待修入库", Date: "2026-09-16 12:00:00",
		}
		if err := s.Maintenance(id, first); err != nil {
			t.Fatalf("首次维修失败: %v", err)
		}
		if err := s.Maintenance(id, first); err == nil {
			t.Fatal("重复提交必须拒绝")
		}
		asset, logs, err := s.GetAsset(id)
		if err != nil {
			t.Fatalf("读取首次维修结果失败: %v", err)
		}
		assets, err := s.AllAssets()
		if err != nil || asset.BoxSN != "BOX-002" || len(logs) != 1 || len(assets) != 2 {
			t.Fatalf("重复提交不得增加旧件或履历: asset=%+v logs=%+v assets=%+v err=%v", asset, logs, assets, err)
		}

		second := MaintenanceReq{
			PartType: "box", OldSN: "BOX-002", NewSN: "BOX-003",
			NewStatus: "在用", MarkOldAs: "故障待修入库", Date: "2026-09-16 13:00:00",
		}
		if err := s.Maintenance(id, second); err != nil {
			t.Fatalf("同一资产第二次真实维修失败: %v", err)
		}
		assets, err = s.AllAssets()
		if err != nil || len(assets) != 3 {
			t.Fatalf("第二次维修应增加一个旧件，assets=%+v err=%v", assets, err)
		}
		codes := map[string]bool{}
		for _, item := range assets {
			if item.ID == id {
				continue
			}
			if item.AssetCode == "" || codes[item.AssetCode] {
				t.Fatalf("旧件 asset_code 必须稳定且不重复，实际 %+v", assets)
			}
			codes[item.AssetCode] = true
		}
		if len(codes) != 2 {
			t.Fatalf("两次维修应得到两个可追溯旧件编码，实际 %+v", codes)
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

func TestUpdateAssetAllowsUpdatingOtherFieldsWhenDuplicateOrNonStandardIPExists(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}

	mustLegacyExec(t, s, `INSERT INTO assets (project_id, asset_code, ip, device_type, status) VALUES (1, 'DUP-1', '138.64.7.122', '云桌面终端', '在用')`)
	mustLegacyExec(t, s, `INSERT INTO assets (project_id, asset_code, ip, device_type, status) VALUES (1, 'DUP-2', '138.64.7.122', '云桌面终端', '在用')`)
	mustLegacyExec(t, s, `INSERT INTO assets (project_id, asset_code, ip, device_type, status) VALUES (1, 'WAN-1', '外网', '云桌面终端', '在用')`)
	mustLegacyExec(t, s, `INSERT INTO assets (project_id, asset_code, ip, device_type, status) VALUES (1, 'WAN-2', '外网', '云桌面终端', '在用')`)

	var id1, wan1 int64
	_ = s.db.QueryRow(`SELECT id FROM assets WHERE asset_code='DUP-1'`).Scan(&id1)
	_ = s.db.QueryRow(`SELECT id FROM assets WHERE asset_code='WAN-1'`).Scan(&wan1)

	err = s.UpdateAssetForProject(scope, &Asset{
		ID:         id1,
		AssetCode:  "DUP-1",
		IP:         "138.64.7.122",
		DeviceType: "云桌面终端",
		OSType:     "统信 UOS",
		OSVersion:  "1050u2",
		Status:     "在用",
	}, "测试员")
	if err != nil {
		t.Fatalf("更新同IP历史资产失败: %v", err)
	}

	err = s.UpdateAssetForProject(scope, &Asset{
		ID:         wan1,
		AssetCode:  "WAN-1",
		IP:         "外网",
		DeviceType: "云桌面终端",
		OSType:     "Windows 10",
		Status:     "在用",
	}, "测试员")
	if err != nil {
		t.Fatalf("更新外网IP历史资产失败: %v", err)
	}
}
