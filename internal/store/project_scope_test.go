package store

import (
	"database/sql"
	"errors"
	"testing"
)

// 此测试会在项目条件遗漏、写入接受调用方 project_id 或跨项目关联被允许时失败。
func TestProjectScopeLegacyDataIsolated(t *testing.T) {
	s := newCmdbTestStore(t)
	projectA, err := s.CreateCmdbProject(&CmdbProject{Code: "project-a", Name: "项目 A"})
	if err != nil {
		t.Fatalf("创建项目 A: %v", err)
	}
	projectB, err := s.CreateCmdbProject(&CmdbProject{Code: "project-b", Name: "项目 B"})
	if err != nil {
		t.Fatalf("创建项目 B: %v", err)
	}
	scopeA := ProjectScope{ProjectID: projectA.ID}
	scopeB := ProjectScope{ProjectID: projectB.ID}

	assetAID, err := s.CreateAssetForProject(scopeA, &Asset{ProjectID: projectB.ID, AssetCode: "同名资产", UserName: "甲", Status: "在用"}, "测试")
	if err != nil {
		t.Fatalf("写入项目 A 资产: %v", err)
	}
	if _, err := s.CreateAssetForProject(scopeB, &Asset{ProjectID: projectA.ID, AssetCode: "同名资产", UserName: "乙", Status: "在用"}, "测试"); err != nil {
		t.Fatalf("写入项目 B 资产: %v", err)
	}
	assetsA, total, err := s.QueryAssetsWithArchivedForProject(scopeA, "", "", "", "", 1, 20, false)
	if err != nil || total != 1 || len(assetsA) != 1 || assetsA[0].UserName != "甲" || assetsA[0].ProjectID != projectA.ID {
		t.Fatalf("项目 A 资产隔离失败: total=%d assets=%+v err=%v", total, assetsA, err)
	}
	if _, _, err := s.GetAssetForProject(scopeB, assetAID); !errors.Is(err, ErrProjectScopedNotFound) || !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("跨项目资产详情必须同时保留项目隔离与详情不存在语义，err=%v", err)
	}

	serverAID, err := s.CreateServerForProject(scopeA, &PhysicalServer{ProjectID: projectB.ID, DeviceName: "同名服务器"}, "测试")
	if err != nil {
		t.Fatalf("写入项目 A 服务器: %v", err)
	}
	serverBID, err := s.CreateServerForProject(scopeB, &PhysicalServer{DeviceName: "同名服务器"}, "测试")
	if err != nil {
		t.Fatalf("写入项目 B 服务器: %v", err)
	}
	if _, err := s.CreateAppForProject(scopeA, &ServerApp{ProjectID: projectA.ID, ServerID: serverBID, AppName: "跨项目应用"}); err == nil {
		t.Fatal("跨项目服务器关联必须被拒绝")
	}
	if _, err := s.CreateAppForProject(scopeA, &ServerApp{ProjectID: projectB.ID, ServerID: serverAID, AppName: "项目 A 应用"}); err != nil {
		t.Fatalf("写入项目 A 应用: %v", err)
	}
	appsA, total, err := s.QueryAllAppsForProject(scopeA, "", "", "", 1, 20)
	if err != nil || total != 1 || len(appsA) != 1 || appsA[0].ProjectID != projectA.ID {
		t.Fatalf("项目 A 应用隔离失败: total=%d apps=%+v err=%v", total, appsA, err)
	}

	if _, err := s.CreateIPEntryForProject(scopeA, &IPEntry{ProjectID: projectB.ID, Subnet: "测试", IP: "10.0.0.1"}); err != nil {
		t.Fatalf("写入项目 A IP: %v", err)
	}
	if _, err := s.CreateIPEntryForProject(scopeB, &IPEntry{Subnet: "测试", IP: "10.0.0.1"}); err != nil {
		t.Fatalf("不同项目同 IP 应允许: %v", err)
	}
	ipsA, total, err := s.QueryIPEntriesForProject(scopeA, IPEntryQuery{Page: 1, PageSize: 20})
	if err != nil || total != 1 || len(ipsA) != 1 || ipsA[0].ProjectID != projectA.ID {
		t.Fatalf("项目 A IP 隔离失败: total=%d ips=%+v err=%v", total, ipsA, err)
	}
	allA, err := s.AllIPEntriesForProject(scopeA, IPEntryQuery{})
	if err != nil || len(allA) != 1 || allA[0].ProjectID != projectA.ID {
		t.Fatalf("项目 A 全量 IP 导出隔离失败: all=%+v err=%v", allA, err)
	}

	statsA, err := s.GetStatsForProject(scopeA)
	if err != nil || statsA["total_servers"] != 1 {
		t.Fatalf("项目 A 统计隔离失败: stats=%+v err=%v", statsA, err)
	}
	results, err := s.GlobalSearchForProject(scopeA, "同名", 20)
	if err != nil {
		t.Fatalf("项目 A 全局查询失败: %v", err)
	}
	for _, result := range results {
		if result.ProjectID != projectA.ID {
			t.Fatalf("全局查询泄露项目 B 数据: %+v", result)
		}
	}
}

func TestProjectScopeProjectCRUDAndValidation(t *testing.T) {
	s := newCmdbTestStore(t)
	if err := (ProjectScope{}).Validate(); err == nil {
		t.Fatal("空项目范围必须无效")
	}
	created, err := s.CreateCmdbProject(&CmdbProject{Code: "project-crud", Name: "原名称"})
	if err != nil {
		t.Fatalf("创建项目: %v", err)
	}
	created.Name = "新名称"
	if err := s.UpdateCmdbProject(created); err != nil {
		t.Fatalf("更新项目: %v", err)
	}
	resolved, err := s.ResolveProject(ProjectScope{ProjectID: created.ID})
	if err != nil || resolved.Name != "新名称" {
		t.Fatalf("解析项目错误: project=%+v err=%v", resolved, err)
	}
	if err := s.DeleteCmdbProject(created.ID); err != nil {
		t.Fatalf("删除项目: %v", err)
	}
	if _, err := s.ResolveProject(ProjectScope{ProjectID: created.ID}); err == nil {
		t.Fatal("已删除项目不得解析")
	}
}
