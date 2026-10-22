package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"sort"
	"strings"
	"time"
)

func (s *Store) ListIPSubnetsForProject(scope ProjectScope) ([]IPSubnet, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	out := []IPSubnet{}
	index := map[string]int{}
	rows, err := s.db.Query(`SELECT id, project_id, IFNULL(sync_id,''), name, IFNULL(category,''), IFNULL(prefix,''), IFNULL(cidr,''),
		IFNULL(gateway,''), IFNULL(vlan,''), IFNULL(vni,''), IFNULL(purpose,''), sort_order, IFNULL(remark,'')
		FROM ip_subnets WHERE project_id = ? ORDER BY sort_order, id`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var v IPSubnet
		if err := rows.Scan(&v.ID, &v.ProjectID, &v.SyncID, &v.Name, &v.Category, &v.Prefix, &v.CIDR, &v.Gateway, &v.VLAN, &v.VNI, &v.Purpose, &v.SortOrder, &v.Remark); err != nil {
			rows.Close()
			return nil, err
		}
		v.Defined = true
		index[v.Name] = len(out)
		out = append(out, v)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	type subnetStat struct{ total, used, reserved, abnormal int }
	stats := map[string]subnetStat{}
	statOrder := []string{}
	statRows, err := s.db.Query(`SELECT subnet,COUNT(*),SUM(CASE WHEN status IN ('在用','已占用','已分配','占用') THEN 1 ELSE 0 END),SUM(CASE WHEN status='保留' THEN 1 ELSE 0 END),SUM(CASE WHEN status IN ('不可用','冲突','异常') THEN 1 ELSE 0 END) FROM ip_pool WHERE project_id=? GROUP BY subnet`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	for statRows.Next() {
		var name string
		var stat subnetStat
		if err := statRows.Scan(&name, &stat.total, &stat.used, &stat.reserved, &stat.abnormal); err != nil {
			statRows.Close()
			return nil, err
		}
		stats[name] = stat
		statOrder = append(statOrder, name)
	}
	if err := statRows.Close(); err != nil {
		return nil, err
	}
	if err := statRows.Err(); err != nil {
		return nil, err
	}
	for _, name := range statOrder {
		if _, ok := index[name]; ok {
			continue
		}
		v := IPSubnet{ProjectID: scope.ProjectID, Name: name, Category: "专网"}
		if name == "外网" {
			v.Category = "外网"
		}
		var sample string
		if err := s.db.QueryRow(`SELECT ip FROM ip_pool WHERE subnet=? AND project_id=? AND ip LIKE '%.%.%.%' ORDER BY id LIMIT 1`, name, scope.ProjectID).Scan(&sample); err == nil {
			v.Prefix = ipPrefixOf(sample)
			if v.Prefix != "" {
				v.CIDR = v.Prefix + ".0/24"
			}
		}
		index[name] = len(out)
		out = append(out, v)
	}
	for name, stat := range stats {
		if i, ok := index[name]; ok {
			out[i].Total = stat.total
			out[i].Used = stat.used
			out[i].Reserved = stat.reserved
			out[i].Abnormal = stat.abnormal
			out[i].Free = max(0, stat.total-stat.used-stat.reserved-stat.abnormal)
		}
	}
	for i := range out {
		if capacity, _, _, ok := usableIPv4Range(normalizeSubnetCIDR(out[i].CIDR, out[i].Prefix)); out[i].Defined && ok {
			out[i].Total = capacity
			out[i].Free = max(0, capacity-out[i].Used-out[i].Reserved-out[i].Abnormal)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		pi, pj := out[i].Prefix, out[j].Prefix
		if pi == "" {
			return false
		}
		if pj == "" {
			return true
		}
		if vi, vj := ipPrefixValue(pi), ipPrefixValue(pj); vi != vj {
			return vi < vj
		}
		return out[i].SortOrder < out[j].SortOrder
	})
	return out, nil
}

func (s *Store) CreateIPSubnetForProject(scope ProjectScope, v *IPSubnet) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	v.Name = strings.TrimSpace(v.Name)
	if v.Name == "" {
		return 0, fmt.Errorf("网段名称不能为空")
	}
	if strings.TrimSpace(v.Category) == "" {
		v.Category = "专网"
	}
	v.CIDR = normalizeSubnetCIDR(v.CIDR, v.Prefix)
	now := time.Now().Format("2006-01-02 15:04:05")
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO ip_subnets
		(project_id, name, category, prefix, cidr, gateway, vlan, vni, purpose, sort_order, remark, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		scope.ProjectID, v.Name, v.Category, v.Prefix, v.CIDR, v.Gateway, v.VLAN, v.VNI, v.Purpose, v.SortOrder, v.Remark, now, now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return 0, fmt.Errorf("网段「%s」已存在", v.Name)
		}
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	v.ID = id
	v.ProjectID = scope.ProjectID
	v.Defined = true
	if err := backfillSubnetAssetIPs(tx, scope.ProjectID, v); err != nil {
		return 0, err
	}
	if err := tx.QueryRow(`SELECT sync_id FROM ip_subnets WHERE id=? AND project_id=?`, id, scope.ProjectID).Scan(&v.SyncID); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return id, nil
}

func backfillSubnetAssetIPs(tx *sql.Tx, projectID int64, subnet *IPSubnet) error {
	prefix, err := netip.ParsePrefix(normalizeSubnetCIDR(subnet.CIDR, subnet.Prefix))
	if err != nil || !prefix.Addr().Is4() {
		return nil
	}
	type candidate struct {
		ip, ownerType, ownerName, account, department, room string
		ownerID                                          int64
	}
	var candidates []candidate
	// 所有基础设施地址先于旧服务器、终端和应用回填，应用共享业务地址时仍由基础设施占用。
	interfaceRows, err := tx.Query(`SELECT IFNULL(i.additional_ips_json,'[]'),a.id,IFNULL(a.name,''),IFNULL(a.owner,''),IFNULL(a.department,''),IFNULL(a.room,'')
		FROM cmdb_asset_interfaces i JOIN cmdb_assets a ON a.id=i.asset_id AND a.project_id=i.project_id
		WHERE i.project_id=? AND a.deleted_at IS NULL`, projectID)
	if err != nil {
		return err
	}
	for interfaceRows.Next() {
		var addressesJSON string
		var item candidate
		if err := interfaceRows.Scan(&addressesJSON, &item.ownerID, &item.ownerName, &item.account, &item.department, &item.room); err != nil {
			interfaceRows.Close()
			return err
		}
		var addresses []cmdbInterfaceAddress
		if json.Unmarshal([]byte(addressesJSON), &addresses) != nil {
			continue
		}
		item.ownerType = "infrastructure"
		for _, address := range addresses {
			item.ip = address.IP
			candidates = append(candidates, item)
		}
	}
	if err := interfaceRows.Err(); err != nil {
		interfaceRows.Close()
		return err
	}
	interfaceRows.Close()
	rows, err := tx.Query(`
		SELECT IFNULL(ip,''), IFNULL(owner_type,''), owner_id, IFNULL(owner_name,''), IFNULL(account,''), IFNULL(department,''), IFNULL(room,'') FROM (
			SELECT mgmt_ip ip, 'infrastructure' owner_type, id owner_id, name owner_name, owner account, department, room, 1 priority FROM cmdb_assets WHERE project_id=? AND deleted_at IS NULL
			UNION ALL SELECT manage_ip, 'infrastructure', id, name, owner, department, room, 1 FROM cmdb_assets WHERE project_id=? AND deleted_at IS NULL
			UNION ALL SELECT biz_ip, 'infrastructure', id, name, owner, department, room, 1 FROM cmdb_assets WHERE project_id=? AND deleted_at IS NULL
			UNION ALL SELECT public_ip, 'infrastructure', id, name, owner, department, room, 1 FROM cmdb_assets WHERE project_id=? AND deleted_at IS NULL
			UNION ALL SELECT i.ip, 'infrastructure', a.id, a.name, a.owner, a.department, a.room, 1 FROM cmdb_asset_interfaces i JOIN cmdb_assets a ON a.id=i.asset_id AND a.project_id=i.project_id WHERE i.project_id=? AND a.deleted_at IS NULL
			UNION ALL SELECT mgmt_ip, 'server', id, device_name, admin_user, '', location, 2 FROM servers WHERE project_id=?
			UNION ALL SELECT biz_ip, 'server', id, device_name, admin_user, '', location, 2 FROM servers WHERE project_id=?
			UNION ALL SELECT ip, 'terminal', id, asset_code, user_name, department, room, 3 FROM assets WHERE project_id=?
			UNION ALL SELECT terminal_ip, 'terminal', id, asset_code, user_name, department, room, 3 FROM assets WHERE project_id=?
			UNION ALL SELECT service_ip, 'application', id, app_name, owner, '', '', 4 FROM server_apps WHERE project_id=? AND deleted_at IS NULL
		) WHERE ip<>'' ORDER BY priority, owner_id`, projectID, projectID, projectID, projectID, projectID, projectID, projectID, projectID, projectID, projectID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var item candidate
		if err := rows.Scan(&item.ip, &item.ownerType, &item.ownerID, &item.ownerName, &item.account, &item.department, &item.room); err != nil {
			rows.Close()
			return err
		}
		candidates = append(candidates, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, item := range candidates {
		address, err := netip.ParseAddr(strings.TrimSpace(item.ip))
		if err != nil || !address.Is4() || !prefix.Contains(address) || specialIPv4Address(prefix.String(), item.ip) != "" {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO ip_pool(project_id,subnet,ip,status,owner_type,owner_id,owner_name,account,department,room)
			SELECT ?,?,?,'在用',?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM ip_pool WHERE project_id=? AND ip=?)`,
			projectID, subnet.Name, item.ip, item.ownerType, item.ownerID, item.ownerName, item.account, item.department, item.room, projectID, item.ip); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) SeedIPSubnetsFromPoolForProject(scope ProjectScope) (int, error) {
	list, err := s.ListIPSubnetsForProject(scope)
	if err != nil {
		return 0, err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	added, order := 0, 0
	for _, v := range list {
		if v.Defined {
			order++
			continue
		}
		cidr := v.CIDR
		if cidr == "" && v.Prefix != "" {
			cidr = v.Prefix + ".0/24"
		}
		res, err := s.db.Exec(`INSERT OR IGNORE INTO ip_subnets(project_id,name,category,prefix,cidr,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`, scope.ProjectID, v.Name, v.Category, v.Prefix, cidr, order, now, now)
		if err != nil {
			return added, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			added++
		}
		order++
	}
	return added, nil
}

func (s *Store) GetIPSubnetForProject(scope ProjectScope, id int64) (*IPSubnet, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	var v IPSubnet
	err := s.db.QueryRow(`SELECT id,project_id,IFNULL(sync_id,''),name,IFNULL(category,''),IFNULL(prefix,''),IFNULL(cidr,''),IFNULL(gateway,''),IFNULL(vlan,''),IFNULL(vni,''),IFNULL(purpose,''),sort_order,IFNULL(remark,'') FROM ip_subnets WHERE id=? AND project_id=?`, id, scope.ProjectID).Scan(&v.ID, &v.ProjectID, &v.SyncID, &v.Name, &v.Category, &v.Prefix, &v.CIDR, &v.Gateway, &v.VLAN, &v.VNI, &v.Purpose, &v.SortOrder, &v.Remark)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("网段不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	if err != nil {
		return nil, err
	}
	v.Defined = true
	return &v, nil
}

func (s *Store) UpdateIPSubnetForProject(scope ProjectScope, v *IPSubnet) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	cur, err := s.GetIPSubnetForProject(scope, v.ID)
	if err != nil {
		return err
	}
	v.Name = strings.TrimSpace(v.Name)
	if v.Name == "" {
		return fmt.Errorf("网段名称不能为空")
	}
	if strings.TrimSpace(v.Category) == "" {
		v.Category = cur.Category
	}
	v.CIDR = normalizeSubnetCIDR(v.CIDR, v.Prefix)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if v.Name != cur.Name {
		var count int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM ip_subnets WHERE name=? AND id<>? AND project_id=?`, v.Name, v.ID, scope.ProjectID).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			return fmt.Errorf("网段「%s」已存在", v.Name)
		}
		if _, err := tx.Exec(`UPDATE ip_pool SET subnet=? WHERE subnet=? AND project_id=?`, v.Name, cur.Name, scope.ProjectID); err != nil {
			return err
		}
	}
	res, err := tx.Exec(`UPDATE ip_subnets SET name=?,category=?,prefix=?,cidr=?,gateway=?,vlan=?,vni=?,purpose=?,sort_order=?,remark=?,updated_at=? WHERE id=? AND project_id=?`, v.Name, v.Category, v.Prefix, v.CIDR, v.Gateway, v.VLAN, v.VNI, v.Purpose, v.SortOrder, v.Remark, time.Now().Format("2006-01-02 15:04:05"), v.ID, scope.ProjectID)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return fmt.Errorf("网段「%s」已存在", v.Name)
		}
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("网段不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	if err := backfillSubnetAssetIPs(tx, scope.ProjectID, v); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteIPSubnetForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	cur, err := s.GetIPSubnetForProject(scope, id)
	if err != nil {
		return err
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM ip_pool WHERE subnet=? AND project_id=?`, cur.Name, scope.ProjectID).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("网段「%s」下还有 %d 个 IP，请先转移或删除这些 IP", cur.Name, count)
	}
	res, err := s.db.Exec(`DELETE FROM ip_subnets WHERE id=? AND project_id=?`, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("网段不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	return nil
}
