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

func TestCmdbProjectAttachmentRootIsLocalPerProject(t *testing.T) {
	s := newCmdbTestStore(t)
	projectA, err := s.CreateCmdbProject(&CmdbProject{Code: "attachment-a", Name: "附件项目 A"})
	if err != nil {
		t.Fatalf("创建项目 A: %v", err)
	}
	projectB, err := s.CreateCmdbProject(&CmdbProject{Code: "attachment-b", Name: "附件项目 B"})
	if err != nil {
		t.Fatalf("创建项目 B: %v", err)
	}
	const root = `D:\cmdb-files\attachment-a`
	if err := s.UpdateProjectAttachmentRoot(projectA.ID, root); err != nil {
		t.Fatalf("更新项目附件目录: %v", err)
	}

	resolvedA, err := s.GetCmdbProject(projectA.ID)
	if err != nil {
		t.Fatalf("读取项目 A: %v", err)
	}
	resolvedB, err := s.GetCmdbProject(projectB.ID)
	if err != nil {
		t.Fatalf("读取项目 B: %v", err)
	}
	if resolvedA.AttachmentRoot != root {
		t.Fatalf("项目 A 附件目录=%q，期望 %q", resolvedA.AttachmentRoot, root)
	}
	if resolvedB.AttachmentRoot != "" {
		t.Fatalf("项目 B 不应继承项目 A 附件目录: %q", resolvedB.AttachmentRoot)
	}

	resolvedA.Name = "附件项目 A（改名）"
	resolvedA.AttachmentRoot = `E:\不应由普通资料更新覆盖`
	if err := s.UpdateCmdbProject(resolvedA); err != nil {
		t.Fatalf("更新项目资料: %v", err)
	}
	resolvedA, err = s.GetCmdbProject(projectA.ID)
	if err != nil {
		t.Fatalf("重新读取项目 A: %v", err)
	}
	if resolvedA.AttachmentRoot != root {
		t.Fatalf("普通项目资料更新覆盖了本机附件目录: %q", resolvedA.AttachmentRoot)
	}
}

func TestDefaultProjectUsesOnlyActiveProjectAfterCodeChange(t *testing.T) {
	s := newCmdbTestStore(t)
	project, err := s.DefaultProject()
	if err != nil {
		t.Fatalf("读取初始默认项目: %v", err)
	}
	project.Code = "CN2026-ZJFY"
	project.Name = "法院"
	if err := s.UpdateCmdbProject(project); err != nil {
		t.Fatalf("更新项目资料: %v", err)
	}

	resolved, err := s.DefaultProject()
	if err != nil {
		t.Fatalf("唯一项目修改编码后仍应作为默认项目: %v", err)
	}
	if resolved.ID != project.ID || resolved.Code != "CN2026-ZJFY" || resolved.Name != "法院" {
		t.Fatalf("默认项目解析错误: %+v", resolved)
	}
}

func TestDefaultProjectDoesNotGuessWhenMultipleActiveProjectsExist(t *testing.T) {
	s := newCmdbTestStore(t)
	project, err := s.DefaultProject()
	if err != nil {
		t.Fatalf("读取初始默认项目: %v", err)
	}
	project.Code = "CN2026-ZJFY"
	if err := s.UpdateCmdbProject(project); err != nil {
		t.Fatalf("更新项目编码: %v", err)
	}
	if _, err := s.CreateCmdbProject(&CmdbProject{Code: "SECOND", Name: "第二项目"}); err != nil {
		t.Fatalf("创建第二项目: %v", err)
	}

	if _, err := s.DefaultProject(); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("多项目且无默认编码时不得猜测项目，err=%v", err)
	}
}

// 此测试会在旧资产操作写穿其他项目同 source_id 的 CMDB 记录时失败。
func TestProjectScopeLegacyWriteThroughDoesNotCrossProject(t *testing.T) {
	tests := []struct {
		name  string
		asset Asset
		run   func(t *testing.T, s *Store, scope ProjectScope, id int64)
		check func(t *testing.T, s *Store, projectID, sourceID int64)
	}{
		{
			name:  "注销",
			asset: Asset{AssetCode: "A-delete", Status: "在用"},
			run: func(t *testing.T, s *Store, scope ProjectScope, id int64) {
				t.Helper()
				if err := s.DeleteAssetForProject(scope, id, "测试注销", "测试"); err != nil {
					t.Fatalf("注销失败: %v", err)
				}
			},
			check: func(t *testing.T, s *Store, projectID, sourceID int64) {
				t.Helper()
				assertMappedCmdbAsset(t, s, projectID, sourceID, "在库", "原使用人", "原部门", "原房间", "B-OLD")
			},
		},
		{
			name:  "调换使用人",
			asset: Asset{AssetCode: "A-transfer", UserName: "原使用人", Department: "原部门", Room: "原房间", Status: "在用"},
			run: func(t *testing.T, s *Store, scope ProjectScope, id int64) {
				t.Helper()
				if err := s.TransferUserForProject(scope, id, TransferReq{ToUser: "新使用人", ToDepartment: "新部门", ToRoom: "新房间"}); err != nil {
					t.Fatalf("调换失败: %v", err)
				}
			},
			check: func(t *testing.T, s *Store, projectID, sourceID int64) {
				t.Helper()
				assertMappedCmdbAsset(t, s, projectID, sourceID, "在库", "原使用人", "原部门", "原房间", "B-OLD")
			},
		},
		{
			name:  "维修换件",
			asset: Asset{AssetCode: "A-maintenance", BoxSN: "A-OLD", Status: "在用"},
			run: func(t *testing.T, s *Store, scope ProjectScope, id int64) {
				t.Helper()
				if err := s.MaintenanceForProject(scope, id, MaintenanceReq{PartType: "box", OldSN: "A-OLD", NewSN: "A-NEW"}); err != nil {
					t.Fatalf("维修失败: %v", err)
				}
			},
			check: func(t *testing.T, s *Store, projectID, sourceID int64) {
				t.Helper()
				assertMappedCmdbAsset(t, s, projectID, sourceID, "在库", "原使用人", "原部门", "原房间", "B-OLD")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newCmdbTestStore(t)
			projectA, err := s.CreateCmdbProject(&CmdbProject{Code: "write-a-" + tt.name, Name: "项目 A"})
			if err != nil {
				t.Fatalf("创建项目 A: %v", err)
			}
			projectB, err := s.CreateCmdbProject(&CmdbProject{Code: "write-b-" + tt.name, Name: "项目 B"})
			if err != nil {
				t.Fatalf("创建项目 B: %v", err)
			}
			scopeA := ProjectScope{ProjectID: projectA.ID}
			assetID, err := s.CreateAssetForProject(scopeA, &tt.asset, "测试")
			if err != nil {
				t.Fatalf("创建项目 A 资产: %v", err)
			}
			insertMappedCmdbAsset(t, s, projectA.ID, assetID, "A-OLD")
			insertMappedCmdbAsset(t, s, projectB.ID, assetID, "B-OLD")

			tt.run(t, s, scopeA, assetID)
			tt.check(t, s, projectB.ID, assetID)
		})
	}
}

// 此测试会在 IP 归属或删除把另一项目同 IP 资产当作当前项目占用时失败。
func TestProjectScopeIPOwnerAndDeleteIsolation(t *testing.T) {
	s := newCmdbTestStore(t)
	projectA, err := s.CreateCmdbProject(&CmdbProject{Code: "ip-owner-a", Name: "项目 A"})
	if err != nil {
		t.Fatalf("创建项目 A: %v", err)
	}
	projectB, err := s.CreateCmdbProject(&CmdbProject{Code: "ip-owner-b", Name: "项目 B"})
	if err != nil {
		t.Fatalf("创建项目 B: %v", err)
	}
	scopeA := ProjectScope{ProjectID: projectA.ID}
	scopeB := ProjectScope{ProjectID: projectB.ID}
	ipAID, err := s.CreateIPEntryForProject(scopeA, &IPEntry{Subnet: "测试", IP: "10.10.10.10"})
	if err != nil {
		t.Fatalf("创建项目 A IP: %v", err)
	}
	ipBID, err := s.CreateIPEntryForProject(scopeB, &IPEntry{Subnet: "测试", IP: "10.10.10.10"})
	if err != nil {
		t.Fatalf("创建项目 B IP: %v", err)
	}
	if _, err := s.CreateAssetForProject(scopeB, &Asset{AssetCode: "B-IP-ASSET", IP: "10.10.10.10", Status: "在用"}, "测试"); err != nil {
		t.Fatalf("创建项目 B 占用资产: %v", err)
	}
	code, user, err := s.IPEntryOwnerForProject(scopeA, ipAID)
	if err != nil || code != "" || user != "" {
		t.Fatalf("项目 A 不得读取项目 B IP 占用资产: code=%q user=%q err=%v", code, user, err)
	}
	if err := s.DeleteIPEntryForProject(scopeA, ipAID, false); err != nil {
		t.Fatalf("项目 B 占用不得阻止删除项目 A IP: %v", err)
	}
	if _, err := s.GetIPEntryForProject(scopeB, ipBID); err != nil {
		t.Fatalf("删除项目 A IP 不得删除项目 B IP: %v", err)
	}
}

func TestProjectScopeNormalizeIPPoolIsolation(t *testing.T) {
	s := newCmdbTestStore(t)
	projectA, err := s.CreateCmdbProject(&CmdbProject{Code: "normalize-a", Name: "规范化项目 A"})
	if err != nil {
		t.Fatal(err)
	}
	projectB, err := s.CreateCmdbProject(&CmdbProject{Code: "normalize-b", Name: "规范化项目 B"})
	if err != nil {
		t.Fatal(err)
	}
	scopeA := ProjectScope{ProjectID: projectA.ID}
	scopeB := ProjectScope{ProjectID: projectB.ID}
	for _, scope := range []ProjectScope{scopeA, scopeB} {
		if _, err := s.db.Exec(`INSERT INTO ip_pool(project_id, subnet, ip, status, remark)
			VALUES (?, '测试', '191.162.17.1 (盒子:180.161.30.1)', '空闲', '')`, scope.ProjectID); err != nil {
			t.Fatal(err)
		}
	}

	normalized, err := s.NormalizeIPPoolIPsForProject(scopeA)
	if err != nil || normalized != 1 {
		t.Fatalf("项目 A 规范化失败: normalized=%d err=%v", normalized, err)
	}
	entryA, _, err := s.QueryIPEntriesForProject(scopeA, IPEntryQuery{Page: 1, PageSize: 20})
	if err != nil || len(entryA) != 1 || entryA[0].IP != "191.162.17.1" {
		t.Fatalf("项目 A 未规范化: entries=%+v err=%v", entryA, err)
	}
	entryB, _, err := s.QueryIPEntriesForProject(scopeB, IPEntryQuery{Page: 1, PageSize: 20})
	if err != nil || len(entryB) != 1 || entryB[0].IP != "191.162.17.1 (盒子:180.161.30.1)" {
		t.Fatalf("项目 B 被跨项目规范化: entries=%+v err=%v", entryB, err)
	}
}

func insertMappedCmdbAsset(t *testing.T, s *Store, projectID, sourceID int64, boxSN string) {
	t.Helper()
	if _, err := s.db.Exec(`INSERT INTO cmdb_assets
		(project_id, name, status, owner, department, room, sn, box_sn, source_type, source_id)
		VALUES (?, '映射资产', '在库', '原使用人', '原部门', '原房间', ?, ?, 'legacy_asset', ?)`, projectID, boxSN, boxSN, sourceID); err != nil {
		t.Fatalf("创建映射 CMDB 资产: %v", err)
	}
}

func assertMappedCmdbAsset(t *testing.T, s *Store, projectID, sourceID int64, wantStatus, wantOwner, wantDepartment, wantRoom, wantBoxSN string) {
	t.Helper()
	var status, owner, department, room, boxSN string
	if err := s.db.QueryRow(`SELECT status, owner, department, room, box_sn
		FROM cmdb_assets WHERE project_id=? AND source_type='legacy_asset' AND source_id=?`, projectID, sourceID).
		Scan(&status, &owner, &department, &room, &boxSN); err != nil {
		t.Fatalf("读取项目 B 映射 CMDB 资产: %v", err)
	}
	if status != wantStatus || owner != wantOwner || department != wantDepartment || room != wantRoom || boxSN != wantBoxSN {
		t.Fatalf("项目 B 映射 CMDB 资产被跨项目修改: status=%q owner=%q department=%q room=%q boxSN=%q", status, owner, department, room, boxSN)
	}
}
