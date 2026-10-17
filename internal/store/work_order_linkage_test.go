package store

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// 如果工单仍只有 cmdb_assets.asset_id，终端资产和业务系统无法同时关联。
func TestWorkOrderLinksTerminalInfrastructureAndApplicationAssets(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	terminalID, err := s.CreateAssetForProject(scope, &Asset{AssetCode: "PC-001", DeviceType: "台式电脑", Status: "在用"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	infrastructureID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "核心交换机", AssetCode: "SW-001", DeviceType: "switch"})
	if err != nil {
		t.Fatal(err)
	}
	serverID, err := s.CreateServerForProject(scope, &PhysicalServer{DeviceName: "应用服务器", BizIP: "10.20.30.10"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	applicationID, err := s.CreateAppForProject(scope, &ServerApp{ServerID: serverID, AppName: "审判业务系统"})
	if err != nil {
		t.Fatal(err)
	}

	workOrder := &CmdbWorkOrder{
		Subject: "联合维护", BizType: "故障处理", OperationType: "排障", Priority: "P2（较高）", PlanTime: "2026-09-21 15:30:00",
		Assets: []WorkOrderAssetRef{
			{AssetType: "terminal", AssetID: terminalID},
			{AssetType: "infrastructure", AssetID: infrastructureID},
			{AssetType: "application", AssetID: applicationID},
		},
	}
	id, err := s.CreateCmdbWorkOrderForProject(scope, workOrder)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.GetCmdbWorkOrderForProject(scope, id)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Assets) != 3 {
		t.Fatalf("工单应关联三类资产，实际 %+v", got.Assets)
	}
	if got.Assets[0].AssetType != "terminal" || got.Assets[0].AssetName != "PC-001" || got.Assets[1].AssetType != "infrastructure" || got.Assets[1].AssetName != "核心交换机" || got.Assets[2].AssetType != "application" || got.Assets[2].AssetName != "审判业务系统" {
		t.Fatalf("工单资产引用解析错误: %+v", got.Assets)
	}
}

// 如果新增筛选只停留在页面，后端查询和导出无法得到一致结果。
func TestWorkOrderQuerySupportsOperationalDimensions(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	_, err := s.CreateCmdbWorkOrderForProject(scope, &CmdbWorkOrder{
		Subject: "交换机巡检", BizType: "日常维护", OperationType: "巡检", Priority: "P3（普通）",
		Owner: "张三", Maintainer: "李四", PlanTime: "2026-09-21 09:00:00",
	})
	if err != nil {
		t.Fatal(err)
	}
	list, total, err := s.QueryCmdbWorkOrdersForProject(scope, CmdbWorkOrderQuery{
		OperationType: "巡检", Priority: "P3（普通）", Owner: "张三", Maintainer: "李四",
		DateFrom: "2026-09-21 00:00:00", DateTo: "2026-09-21 23:59:59", Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(list) != 1 || list[0].Subject != "交换机巡检" {
		t.Fatalf("多维筛选未生效: total=%d list=%+v", total, list)
	}
}

// 附件内容必须落在数据库同目录的附件目录，数据库只保存可审计元数据。
func TestWorkOrderAttachmentLifecycle(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "attachments.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	scope, _ := s.DefaultProjectScope()
	workOrderID, err := s.CreateCmdbWorkOrderForProject(scope, &CmdbWorkOrder{Subject: "附件测试"})
	if err != nil {
		t.Fatal(err)
	}
	attachment, err := s.SaveWorkOrderAttachmentForProject(scope, workOrderID, "现场 照片.png", "image/png", bytes.NewBufferString("png-data"))
	if err != nil {
		t.Fatal(err)
	}
	if attachment.FileName != "现场 照片.png" || attachment.SizeBytes != 8 || attachment.StoredPath == "" {
		t.Fatalf("附件元数据错误: %+v", attachment)
	}
	if !filepath.IsAbs(attachment.StoredPath) {
		t.Fatalf("内部读取路径应为绝对路径: %s", attachment.StoredPath)
	}
	if data, err := os.ReadFile(attachment.StoredPath); err != nil || string(data) != "png-data" {
		t.Fatalf("附件未正确落盘: data=%q err=%v", data, err)
	}
	list, err := s.ListWorkOrderAttachmentsForProject(scope, workOrderID)
	if err != nil || len(list) != 1 || list[0].ID != attachment.ID {
		t.Fatalf("附件列表错误: list=%+v err=%v", list, err)
	}
	if err := s.DeleteWorkOrderAttachmentForProject(scope, workOrderID, attachment.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(attachment.StoredPath); !os.IsNotExist(err) {
		t.Fatalf("删除附件后文件仍存在: %v", err)
	}
}

func TestDeleteWorkOrderAttachmentRestoresMetadataWhenFileRemovalFails(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "attachment-delete-rollback.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	scope, _ := s.DefaultProjectScope()
	workOrderID, err := s.CreateCmdbWorkOrderForProject(scope, &CmdbWorkOrder{Subject: "附件删除回滚"})
	if err != nil {
		t.Fatal(err)
	}
	attachment, err := s.SaveWorkOrderAttachmentForProject(scope, workOrderID, "证据.txt", "text/plain", bytes.NewBufferString("evidence"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(attachment.StoredPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(attachment.StoredPath, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(attachment.StoredPath, "nested.txt"), []byte("blocked"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteWorkOrderAttachmentForProject(scope, workOrderID, attachment.ID); err == nil {
		t.Fatal("文件无法删除时应返回错误")
	}
	if _, err := s.GetWorkOrderAttachmentForProject(scope, workOrderID, attachment.ID); err != nil {
		t.Fatalf("删除失败后附件元数据应保留: %v", err)
	}
	if _, err := os.Stat(attachment.StoredPath); err != nil {
		t.Fatalf("删除失败后附件原路径应恢复: %v", err)
	}
}

func TestDeleteWorkOrderRemovesAttachmentFiles(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "delete-work-order-attachments.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	scope, _ := s.DefaultProjectScope()
	workOrderID, err := s.CreateCmdbWorkOrderForProject(scope, &CmdbWorkOrder{Subject: "删除附件测试"})
	if err != nil {
		t.Fatal(err)
	}
	attachment, err := s.SaveWorkOrderAttachmentForProject(scope, workOrderID, "现场.txt", "text/plain", bytes.NewBufferString("evidence"))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteCmdbWorkOrderForProject(scope, workOrderID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(attachment.StoredPath); !os.IsNotExist(err) {
		t.Fatalf("删除工单后附件文件仍存在: %v", err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_work_order_attachments WHERE project_id=? AND work_order_id=?`, scope.ProjectID, workOrderID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("删除工单后附件元数据仍有 %d 条", count)
	}
}

func TestServerAppProviderRoundTrip(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	serverID, err := s.CreateServerForProject(scope, &PhysicalServer{DeviceName: "业务节点"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	appID, err := s.CreateAppForProject(scope, &ServerApp{ServerID: serverID, AppName: "档案系统", Provider: "供应商甲"})
	if err != nil {
		t.Fatal(err)
	}
	apps, _, err := s.QueryAllAppsForProject(scope, "供应商甲", "", "", 1, 20)
	if err != nil || len(apps) != 1 || apps[0].ID != appID || apps[0].Provider != "供应商甲" {
		t.Fatalf("业务系统供应商保存或搜索失败: apps=%+v err=%v", apps, err)
	}
	apps[0].Provider = "供应商乙"
	if err := s.UpdateAppForProject(scope, &apps[0]); err != nil {
		t.Fatal(err)
	}
	updated, _, err := s.QueryAllAppsForProject(scope, "供应商乙", "", "", 1, 20)
	if err != nil || len(updated) != 1 || updated[0].Provider != "供应商乙" {
		t.Fatalf("业务系统供应商更新失败: apps=%+v err=%v", updated, err)
	}
}

func TestServerAppQueryFiltersActualFieldsAndPersistedNetwork(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	if _, err := s.CreateIPSubnetForProject(scope, &IPSubnet{Name: "业务网", Category: "专网", CIDR: "10.120.0.0/24"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateIPSubnetForProject(scope, &IPSubnet{Name: "外网", Category: "外网", CIDR: "10.121.0.0/24"}); err != nil {
		t.Fatal(err)
	}
	hostID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "应用服务器", DeviceType: "server", MgmtIP: "10.120.0.2", BizIP: "10.120.0.10"})
	if err != nil {
		t.Fatal(err)
	}
	matching := &ServerApp{AppName: "审判系统", AppType: "业务应用", Provider: "甲供应商", Owner: "张三", GroupID: 0, CmdbAssetID: hostID, ServiceIP: "10.120.0.10", NetworkType: "专网", Status: "正常运行"}
	if _, err := s.CreateAppForProject(scope, matching); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAppForProject(scope, &ServerApp{AppName: "无关系统", AppType: "业务应用", Provider: "乙供应商", Owner: "李四", ServiceIP: "10.121.0.10", Status: "正常运行"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAppForProject(scope, &ServerApp{AppName: "待配置系统"}); err != nil {
		t.Fatal(err)
	}
	rows, total, err := s.QueryServerAppsForProject(scope, ServerAppQuery{Provider: "甲供应商", Owner: "张三", NetworkType: "专网", HostID: hostID, HostLinked: "linked", Page: 1, PageSize: 20})
	if err != nil || total != 1 || len(rows) != 1 || rows[0].AppName != "审判系统" || rows[0].NetworkType != "专网" {
		t.Fatalf("业务系统实际字段筛选或独立网络标识错误: rows=%+v total=%d err=%v", rows, total, err)
	}
	rows, total, err = s.QueryServerAppsForProject(scope, ServerAppQuery{NetworkType: "专网", HostLinked: "unlinked", Page: 1, PageSize: 20})
	if err != nil || total != 0 || len(rows) != 0 {
		t.Fatalf("承载服务器关联筛选错误: rows=%+v total=%d err=%v", rows, total, err)
	}
	rows, total, err = s.QueryServerAppsForProject(scope, ServerAppQuery{AppType: AssetUnconfiguredFilter, Status: AssetUnconfiguredFilter, Provider: AssetUnconfiguredFilter, Owner: AssetUnconfiguredFilter, GroupID: -1, HostLinked: "unlinked", NetworkType: AssetUnconfiguredFilter, Page: 1, PageSize: 20})
	if err != nil || total != 1 || len(rows) != 1 || rows[0].AppName != "待配置系统" {
		t.Fatalf("未分类、未分组和未配置条件筛选错误: rows=%+v total=%d err=%v", rows, total, err)
	}
}
