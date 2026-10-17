package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// CmdbAssetLink 描述两个 CMDB 资产端口之间的链路。
type CmdbAssetLink struct {
	ID               int64  `json:"id"`
	ProjectID        int64  `json:"project_id"`
	LocalAssetID     int64  `json:"local_asset_id"`
	LocalInterfaceID int64  `json:"local_interface_id"`
	LocalPort        string `json:"local_port"`
	Direction        string `json:"direction"`
	PeerAssetID      int64  `json:"peer_asset_id"`
	PeerAssetName    string `json:"peer_asset_name"`
	PeerAssetCode    string `json:"peer_asset_code"`
	PeerDeviceType   string `json:"peer_device_type"`
	PeerPort         string `json:"peer_port"`
	VLAN             string `json:"vlan"`
	VNI              string `json:"vni"`
	Status           string `json:"status"`
	Remark           string `json:"remark"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

// CmdbAssetIPAM 是资产 IP 与网段定义的聚合结果。
type CmdbAssetIPAM struct {
	ID       int64  `json:"id"`
	IP       string `json:"ip"`
	Subnet   string `json:"subnet"`
	Status   string `json:"status"`
	Category string `json:"category"`
	CIDR     string `json:"cidr"`
	Gateway  string `json:"gateway"`
	VLAN     string `json:"vlan"`
	VNI      string `json:"vni"`
	Purpose  string `json:"purpose"`
}

// CmdbAssetHistory 是资产详情使用的紧凑履历模型。
type CmdbAssetHistory struct {
	ID          int64  `json:"id"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Operator    string `json:"operator"`
	OccurredAt  string `json:"occurred_at"`
}

type CmdbAssetRelations struct {
	IPAM                []CmdbAssetIPAM    `json:"ipam"`
	Links               []CmdbAssetLink    `json:"links"`
	UpstreamAssets      []CmdbAsset        `json:"upstream_assets"`
	DownstreamAssets    []CmdbAsset        `json:"downstream_assets"`
	RelatedApplications []ServerApp        `json:"related_applications"`
	History             []CmdbAssetHistory `json:"history"`
}

func reverseLinkDirection(direction string) string {
	if direction == "uplink" {
		return "downlink"
	}
	if direction == "downlink" {
		return "uplink"
	}
	return direction
}

func validateLinkDirection(direction string) error {
	switch direction {
	case "uplink", "downlink":
		return nil
	default:
		return fmt.Errorf("链路方向必须是 uplink 或 downlink")
	}
}

func (s *Store) ListCmdbAssetLinksForProject(scope ProjectScope, assetID int64) ([]CmdbAssetLink, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	if err := s.requireAssetInProject(s.db, scope.ProjectID, assetID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`
		SELECT l.id,l.project_id,
			CASE WHEN l.local_asset_id=? THEN l.local_asset_id ELSE l.peer_asset_id END,
			CASE WHEN l.local_asset_id=? THEN l.local_interface_id ELSE 0 END,
			CASE WHEN l.local_asset_id=? THEN l.local_port ELSE l.peer_port END,
			l.direction,l.local_asset_id,
			CASE WHEN l.local_asset_id=? THEN l.peer_asset_id ELSE l.local_asset_id END,
			IFNULL(peer.name,''),IFNULL(peer.asset_code,''),IFNULL(peer.device_type,''),
			CASE WHEN l.local_asset_id=? THEN l.peer_port ELSE l.local_port END,
			IFNULL(l.vlan,''),IFNULL(l.vni,''),IFNULL(l.status,''),IFNULL(l.remark,''),
			IFNULL(l.created_at,''),IFNULL(l.updated_at,'')
		FROM cmdb_asset_links l
		JOIN cmdb_assets peer ON peer.id=CASE WHEN l.local_asset_id=? THEN l.peer_asset_id ELSE l.local_asset_id END
			AND peer.project_id=l.project_id
		WHERE l.project_id=? AND (l.local_asset_id=? OR l.peer_asset_id=?)
		ORDER BY l.local_port,l.id`, assetID, assetID, assetID, assetID, assetID, assetID, scope.ProjectID, assetID, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	links := make([]CmdbAssetLink, 0)
	for rows.Next() {
		var link CmdbAssetLink
		var storedDirection string
		var storedLocalID int64
		if err := rows.Scan(&link.ID, &link.ProjectID, &link.LocalAssetID, &link.LocalInterfaceID, &link.LocalPort,
			&storedDirection, &storedLocalID, &link.PeerAssetID, &link.PeerAssetName, &link.PeerAssetCode,
			&link.PeerDeviceType, &link.PeerPort, &link.VLAN, &link.VNI, &link.Status, &link.Remark,
			&link.CreatedAt, &link.UpdatedAt); err != nil {
			return nil, err
		}
		link.Direction = storedDirection
		if storedLocalID != assetID {
			link.Direction = reverseLinkDirection(storedDirection)
		}
		links = append(links, link)
	}
	return links, rows.Err()
}

func (s *Store) CreateCmdbAssetLinkForProject(scope ProjectScope, link *CmdbAssetLink) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if link == nil {
		return 0, fmt.Errorf("链路信息不能为空")
	}
	link.LocalPort = strings.TrimSpace(link.LocalPort)
	link.PeerPort = strings.TrimSpace(link.PeerPort)
	if link.LocalPort == "" {
		return 0, fmt.Errorf("本端端口不能为空")
	}
	if link.PeerAssetID <= 0 {
		return 0, fmt.Errorf("请选择对端设备")
	}
	if link.LocalAssetID == link.PeerAssetID {
		return 0, fmt.Errorf("本端设备和对端设备不能相同")
	}
	if err := validateLinkDirection(link.Direction); err != nil {
		return 0, err
	}
	if err := s.requireAssetInProject(s.db, scope.ProjectID, link.LocalAssetID); err != nil {
		return 0, fmt.Errorf("本端资产不存在: %w", err)
	}
	if err := s.requireAssetInProject(s.db, scope.ProjectID, link.PeerAssetID); err != nil {
		return 0, fmt.Errorf("对端资产不存在: %w", err)
	}
	if link.LocalInterfaceID > 0 {
		var exists int
		if err := s.db.QueryRow(`SELECT 1 FROM cmdb_asset_interfaces WHERE id=? AND asset_id=? AND project_id=?`, link.LocalInterfaceID, link.LocalAssetID, scope.ProjectID).Scan(&exists); err != nil {
			return 0, fmt.Errorf("本端网络接口不存在")
		}
	}
	if strings.TrimSpace(link.Status) == "" {
		link.Status = "在线"
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO cmdb_asset_links
		(project_id,local_asset_id,local_interface_id,local_port,direction,peer_asset_id,peer_port,vlan,vni,status,remark,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, scope.ProjectID, link.LocalAssetID, link.LocalInterfaceID, link.LocalPort,
		link.Direction, link.PeerAssetID, link.PeerPort, link.VLAN, link.VNI, link.Status, link.Remark, now, now)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	description := fmt.Sprintf("%s %s %d:%s", link.LocalPort, link.Direction, link.PeerAssetID, link.PeerPort)
	if err := appendCmdbAssetHistory(tx, scope.ProjectID, link.LocalAssetID, "新增链路", description, "系统"); err != nil {
		return 0, err
	}
	if err := appendCmdbAssetHistory(tx, scope.ProjectID, link.PeerAssetID, "新增链路", description, "系统"); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return id, nil
}

func (s *Store) UpdateCmdbAssetLinkForProject(scope ProjectScope, link *CmdbAssetLink) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if link == nil || link.ID <= 0 {
		return fmt.Errorf("无效的链路 ID")
	}
	var localAssetID int64
	if err := s.db.QueryRow(`SELECT local_asset_id FROM cmdb_asset_links WHERE id=? AND project_id=?`, link.ID, scope.ProjectID).Scan(&localAssetID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("链路不存在: %w", ErrProjectScopedNotFound)
		}
		return err
	}
	link.LocalAssetID = localAssetID
	if err := validateLinkDirection(link.Direction); err != nil {
		return err
	}
	if link.PeerAssetID <= 0 || link.PeerAssetID == localAssetID {
		return fmt.Errorf("请选择有效的对端设备")
	}
	if err := s.requireAssetInProject(s.db, scope.ProjectID, link.PeerAssetID); err != nil {
		return fmt.Errorf("对端资产不存在: %w", err)
	}
	link.LocalPort = strings.TrimSpace(link.LocalPort)
	if link.LocalPort == "" {
		return fmt.Errorf("本端端口不能为空")
	}
	if strings.TrimSpace(link.Status) == "" {
		link.Status = "在线"
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`UPDATE cmdb_asset_links SET local_interface_id=?,local_port=?,direction=?,peer_asset_id=?,peer_port=?,vlan=?,vni=?,status=?,remark=?,updated_at=? WHERE id=? AND project_id=?`,
		link.LocalInterfaceID, link.LocalPort, link.Direction, link.PeerAssetID, strings.TrimSpace(link.PeerPort), link.VLAN, link.VNI,
		link.Status, link.Remark, time.Now().Format("2006-01-02 15:04:05"), link.ID, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("链路不存在: %w", ErrProjectScopedNotFound)
	}
	description := fmt.Sprintf("%s %s %d:%s", link.LocalPort, link.Direction, link.PeerAssetID, link.PeerPort)
	if err := appendCmdbAssetHistory(tx, scope.ProjectID, localAssetID, "修改链路", description, "系统"); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteCmdbAssetLinkForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	var localID, peerID int64
	var localPort, peerPort string
	if err := s.db.QueryRow(`SELECT local_asset_id,peer_asset_id,local_port,IFNULL(peer_port,'') FROM cmdb_asset_links WHERE id=? AND project_id=?`, id, scope.ProjectID).Scan(&localID, &peerID, &localPort, &peerPort); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("链路不存在: %w", ErrProjectScopedNotFound)
		}
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`DELETE FROM cmdb_asset_links WHERE id=? AND project_id=?`, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("链路不存在: %w", ErrProjectScopedNotFound)
	}
	description := fmt.Sprintf("%s -> %d:%s", localPort, peerID, peerPort)
	if err := appendCmdbAssetHistory(tx, scope.ProjectID, localID, "删除链路", description, "系统"); err != nil {
		return err
	}
	if err := appendCmdbAssetHistory(tx, scope.ProjectID, peerID, "删除链路", description, "系统"); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) CmdbAssetRelationsForProject(scope ProjectScope, asset *CmdbAsset, ifaces []CmdbAssetInterface) (*CmdbAssetRelations, error) {
	relations := &CmdbAssetRelations{
		IPAM: []CmdbAssetIPAM{}, Links: []CmdbAssetLink{}, UpstreamAssets: []CmdbAsset{},
		DownstreamAssets: []CmdbAsset{}, RelatedApplications: []ServerApp{}, History: []CmdbAssetHistory{},
	}
	links, err := s.ListCmdbAssetLinksForProject(scope, asset.ID)
	if err != nil {
		return nil, err
	}
	relations.Links = links
	for _, link := range links {
		peer, _, err := s.GetCmdbAssetForProject(scope, link.PeerAssetID)
		if err != nil {
			return nil, err
		}
		if link.Direction == "uplink" {
			relations.UpstreamAssets = append(relations.UpstreamAssets, *peer)
		} else {
			relations.DownstreamAssets = append(relations.DownstreamAssets, *peer)
		}
		direction := "下联至"
		if link.Direction == "uplink" {
			direction = "上联至"
		}
		relations.History = append(relations.History, CmdbAssetHistory{
			ID: link.ID, Type: "链路登记", Operator: "系统", OccurredAt: link.CreatedAt,
			Description: fmt.Sprintf("%s %s %s %s", link.LocalPort, direction, link.PeerAssetName, link.PeerPort),
		})
	}

	ips := make([]string, 0, len(ifaces)+4)
	seen := map[string]bool{}
	for _, ip := range []string{asset.MgmtIP, asset.ManageIP, asset.BizIP, asset.PublicIP} {
		ip = strings.TrimSpace(ip)
		if ip != "" && !seen[ip] {
			seen[ip] = true
			ips = append(ips, ip)
		}
	}
	for ip := range cmdbAssetIPs(nil, ifaces) {
		if ip != "" && !seen[ip] {
			seen[ip] = true
			ips = append(ips, ip)
		}
	}
	if len(ips) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(ips)), ",")
		args := make([]interface{}, 0, len(ips)+2)
		args = append(args, scope.ProjectID, scope.ProjectID)
		for _, ip := range ips {
			args = append(args, ip)
		}
		rows, err := s.db.Query(`SELECT p.id,p.ip,IFNULL(p.subnet,''),IFNULL(p.status,''),IFNULL(n.category,''),
			IFNULL(n.cidr,''),IFNULL(n.gateway,''),IFNULL(n.vlan,''),IFNULL(n.vni,''),IFNULL(n.purpose,'')
			FROM ip_pool p LEFT JOIN ip_subnets n ON n.project_id=? AND n.name=p.subnet
			WHERE p.project_id=? AND p.ip IN (`+placeholders+`) ORDER BY p.ip`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var item CmdbAssetIPAM
			if err := rows.Scan(&item.ID, &item.IP, &item.Subnet, &item.Status, &item.Category, &item.CIDR, &item.Gateway, &item.VLAN, &item.VNI, &item.Purpose); err != nil {
				rows.Close()
				return nil, err
			}
			relations.IPAM = append(relations.IPAM, item)
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		registered := map[string]bool{}
		for _, item := range relations.IPAM {
			registered[item.IP] = true
		}
		for _, ip := range ips {
			if !registered[ip] {
				relations.IPAM = append(relations.IPAM, CmdbAssetIPAM{IP: ip, Status: "未纳入 IPAM"})
			}
		}
	}

	// 业务系统只能挂在服务器类基础设施上。这里同时兼容新关联字段
	// cmdb_asset_id 和历史台账中的 server_id，保证服务器详情能看到已有系统。
	if isCmdbApplicationHostType(asset.DeviceType, asset.CategoryName) {
		where := "app.project_id=? AND app.cmdb_asset_id=?"
		args := []interface{}{scope.ProjectID, asset.ID}
		if asset.SourceType == "legacy_server" && asset.SourceID > 0 {
			where = "app.project_id=? AND (app.cmdb_asset_id=? OR app.server_id=?)"
			args = []interface{}{scope.ProjectID, asset.ID, asset.SourceID}
		}
		rows, err := s.db.Query(serverAppDetailSelect+` WHERE `+where+` AND IFNULL(app.status,'') NOT IN ('已归档','已注销') ORDER BY app.id DESC`, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var app ServerApp
			if err := scanServerAppDetail(rows, &app); err != nil {
				return nil, err
			}
			relations.RelatedApplications = append(relations.RelatedApplications, app)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	if asset.SourceType == "legacy_asset" && asset.SourceID > 0 {
		logs, _, err := s.QueryLogsForProject(scope, asset.SourceID, "", "", 1, 100)
		if err != nil {
			return nil, err
		}
		for _, log := range logs {
			relations.History = append(relations.History, CmdbAssetHistory{ID: log.ID, Type: log.LogType, Description: log.Description, Operator: log.Operator, OccurredAt: log.LogTime})
		}
	}
	persistentHistory, err := s.ListCmdbAssetHistoryForProject(scope, asset.ID, 100)
	if err != nil {
		return nil, err
	}
	for _, item := range persistentHistory {
		if item.Type != "新增链路" && item.Type != "修改链路" {
			relations.History = append(relations.History, item)
		}
	}
	return relations, nil
}
