package store

import "testing"

func TestCmdbServerRelationsIncludeApplications(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	serverID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{
		Name:       "应用服务器",
		AssetCode:  "SRV-001",
		DeviceType: "server",
		BizIP:      "10.0.0.10",
	})
	if err != nil {
		t.Fatal(err)
	}
	appID, err := s.CreateAppForProject(scope, &ServerApp{CmdbAssetID: serverID, AppName: "审判系统"})
	if err != nil {
		t.Fatal(err)
	}
	asset, ifaces, err := s.GetCmdbAssetForProject(scope, serverID)
	if err != nil {
		t.Fatal(err)
	}
	relations, err := s.CmdbAssetRelationsForProject(scope, asset, ifaces)
	if err != nil {
		t.Fatal(err)
	}
	if len(relations.RelatedApplications) != 1 || relations.RelatedApplications[0].ID != appID {
		t.Fatalf("服务器应反查承载业务系统，实际 %+v", relations.RelatedApplications)
	}

	switchID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{
		Name:       "核心交换机",
		AssetCode:  "SW-001",
		DeviceType: "switch",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAppForProject(scope, &ServerApp{CmdbAssetID: switchID, AppName: "不应成功"}); err == nil {
		t.Fatal("交换机不应作为业务系统承载服务器")
	}
	switchAsset, switchIfaces, err := s.GetCmdbAssetForProject(scope, switchID)
	if err != nil {
		t.Fatal(err)
	}
	switchRelations, err := s.CmdbAssetRelationsForProject(scope, switchAsset, switchIfaces)
	if err != nil {
		t.Fatal(err)
	}
	if len(switchRelations.RelatedApplications) != 0 {
		t.Fatalf("网络设备不应展示业务系统，实际 %+v", switchRelations.RelatedApplications)
	}

	storageID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{
		Name:       "共享存储",
		AssetCode:  "STO-001",
		DeviceType: "storage",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAppForProject(scope, &ServerApp{CmdbAssetID: storageID, AppName: "存储管理服务"}); err != nil {
		t.Fatalf("除交换机和路由器外的基础设施应可作为承载对象: %v", err)
	}
}
