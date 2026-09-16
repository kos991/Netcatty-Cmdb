package store

import (
	"fmt"
	"strings"
	"time"
)

// Person 对应 cmdb_persons 表。
type Person struct {
	ID         int64  `json:"id"`
	PersonCode string `json:"person_code"`
	Name       string `json:"name"`
	OrgName    string `json:"org_name"`
	GroupName  string `json:"group_name"`
	Department string `json:"department"`
	Title      string `json:"title"`
	Phone      string `json:"phone"`
	Email      string `json:"email"`
	Status     string `json:"status"` // 在职 / 离职 / 调休
	Remark     string `json:"remark"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
	AssetCount int    `json:"asset_count"` // 穿透计算名下资产数量
}

// PersonQuery 人员列表筛选参数。
type PersonQuery struct {
	Keyword    string
	Department string
	OrgName    string
	GroupName  string
	Status     string
	Page       int
	PageSize   int
}

// PersonTransferReq 人员资产一键交接请求。
type PersonTransferReq struct {
	FromPersonID int64   `json:"from_person_id"`
	ToPersonID   int64   `json:"to_person_id"`
	AssetIDs     []int64 `json:"asset_ids,omitempty"`
	Operator     string  `json:"operator"`
	Remark       string  `json:"remark"`
}

// ListPersons 分页查询人员列表，并统计名下资产数量。
func (s *Store) ListPersons(q PersonQuery) ([]Person, int, error) {
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 || q.PageSize > 500 {
		q.PageSize = 20
	}

	var where []string
	var args []interface{}

	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		pat := "%" + kw + "%"
		where = append(where, "(p.name LIKE ? OR IFNULL(p.person_code,'') LIKE ? OR IFNULL(p.phone,'') LIKE ? OR IFNULL(p.email,'') LIKE ?)")
		args = append(args, pat, pat, pat, pat)
	}
	if dept := strings.TrimSpace(q.Department); dept != "" && dept != "全部" {
		where = append(where, "p.department = ?")
		args = append(args, dept)
	}
	if org := strings.TrimSpace(q.OrgName); org != "" && org != "全部" {
		where = append(where, "p.org_name = ?")
		args = append(args, org)
	}
	if grp := strings.TrimSpace(q.GroupName); grp != "" && grp != "全部" {
		where = append(where, "p.group_name = ?")
		args = append(args, grp)
	}
	if st := strings.TrimSpace(q.Status); st != "" && st != "全部" {
		where = append(where, "p.status = ?")
		args = append(args, st)
	}

	whereClause := ""
	if len(where) > 0 {
		whereClause = " WHERE " + strings.Join(where, " AND ")
	}

	var total int
	countQuery := "SELECT COUNT(*) FROM cmdb_persons p" + whereClause
	if err := s.db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (q.Page - 1) * q.PageSize
	query := fmt.Sprintf(`
		SELECT p.id, IFNULL(p.person_code,''), p.name, IFNULL(p.org_name,''), IFNULL(p.group_name,''),
		       p.department, IFNULL(p.title,''), IFNULL(p.phone,''), IFNULL(p.email,''),
		       p.status, IFNULL(p.remark,''), IFNULL(p.created_at,''), IFNULL(p.updated_at,''),
		       (SELECT COUNT(*) FROM cmdb_assets a WHERE a.owner_id = p.id OR (a.owner_id = 0 AND a.owner = p.name)) AS asset_count
		FROM cmdb_persons p
		%s
		ORDER BY p.id DESC
		LIMIT ? OFFSET ?`, whereClause)

	queryArgs := append(append([]interface{}{}, args...), q.PageSize, offset)
	rows, err := s.db.Query(query, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	list := make([]Person, 0, q.PageSize)
	for rows.Next() {
		var p Person
		if err := rows.Scan(
			&p.ID, &p.PersonCode, &p.Name, &p.OrgName, &p.GroupName,
			&p.Department, &p.Title, &p.Phone, &p.Email,
			&p.Status, &p.Remark, &p.CreatedAt, &p.UpdatedAt,
			&p.AssetCount,
		); err != nil {
			return nil, 0, err
		}
		list = append(list, p)
	}

	return list, total, rows.Err()
}

// GetPerson 读取单个人员信息。
func (s *Store) GetPerson(id int64) (*Person, error) {
	var p Person
	query := `
		SELECT p.id, IFNULL(p.person_code,''), p.name, IFNULL(p.org_name,''), IFNULL(p.group_name,''),
		       p.department, IFNULL(p.title,''), IFNULL(p.phone,''), IFNULL(p.email,''),
		       p.status, IFNULL(p.remark,''), IFNULL(p.created_at,''), IFNULL(p.updated_at,''),
		       (SELECT COUNT(*) FROM cmdb_assets a WHERE a.owner_id = p.id OR (a.owner_id = 0 AND a.owner = p.name)) AS asset_count
		FROM cmdb_persons p
		WHERE p.id = ?`

	err := s.db.QueryRow(query, id).Scan(
		&p.ID, &p.PersonCode, &p.Name, &p.OrgName, &p.GroupName,
		&p.Department, &p.Title, &p.Phone, &p.Email,
		&p.Status, &p.Remark, &p.CreatedAt, &p.UpdatedAt,
		&p.AssetCount,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// CreatePerson 创建新人员。
func (s *Store) CreatePerson(p *Person) (int64, error) {
	p.Name = strings.TrimSpace(p.Name)
	p.Department = strings.TrimSpace(p.Department)
	if p.Name == "" {
		return 0, fmt.Errorf("人员姓名不能为空")
	}
	if p.Department == "" {
		return 0, fmt.Errorf("所属部门不能为空")
	}
	if p.Status == "" {
		p.Status = "在职"
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	p.CreatedAt = now
	p.UpdatedAt = now

	res, err := s.db.Exec(`
		INSERT INTO cmdb_persons (person_code, name, org_name, group_name, department, title, phone, email, status, remark, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.PersonCode, p.Name, p.OrgName, p.GroupName, p.Department, p.Title, p.Phone, p.Email, p.Status, p.Remark, p.CreatedAt, p.UpdatedAt,
	)
	if err != nil {
		return 0, err
	}
	newID, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	p.ID = newID
	return newID, nil
}

// UpdatePerson 更新人员信息。
func (s *Store) UpdatePerson(p *Person) error {
	p.Name = strings.TrimSpace(p.Name)
	p.Department = strings.TrimSpace(p.Department)
	if p.Name == "" {
		return fmt.Errorf("人员姓名不能为空")
	}
	if p.Department == "" {
		return fmt.Errorf("所属部门不能为空")
	}
	if p.Status == "" {
		p.Status = "在职"
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	p.UpdatedAt = now

	res, err := s.db.Exec(`
		UPDATE cmdb_persons
		SET person_code = ?, name = ?, org_name = ?, group_name = ?, department = ?, title = ?, phone = ?, email = ?, status = ?, remark = ?, updated_at = ?
		WHERE id = ?`,
		p.PersonCode, p.Name, p.OrgName, p.GroupName, p.Department, p.Title, p.Phone, p.Email, p.Status, p.Remark, p.UpdatedAt, p.ID,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("人员不存在")
	}
	return nil
}

// DeletePerson 删除人员。
func (s *Store) DeletePerson(id int64) error {
	res, err := s.db.Exec("DELETE FROM cmdb_persons WHERE id = ?", id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("人员不存在")
	}
	// 将名下绑定了该 owner_id 的资产解除 owner_id 绑定（保留 owner 姓名字符串）
	_, _ = s.db.Exec("UPDATE cmdb_assets SET owner_id = 0 WHERE owner_id = ?", id)
	return nil
}

// GetPersonAssets 穿透查询指定人员名下的所有资产（PC、服务器、虚拟机等）。
func (s *Store) GetPersonAssets(personID int64) (*Person, []CmdbAsset, error) {
	person, err := s.GetPerson(personID)
	if err != nil {
		return nil, nil, fmt.Errorf("人员不存在: %w", err)
	}

	query := cmdbAssetSelect + " WHERE (a.owner_id = ? OR (a.owner_id = 0 AND a.owner = ?)) ORDER BY a.id DESC"
	rows, err := s.db.Query(query, person.ID, person.Name)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var assets []CmdbAsset
	for rows.Next() {
		asset, err := scanCmdbAsset(rows)
		if err != nil {
			return nil, nil, err
		}
		assets = append(assets, asset)
	}
	rows.Close()

	for i := range assets {
		ifaces, _ := s.getAssetInterfaces(assets[i].ID)
		assets[i].Interfaces = ifaces
	}
	if assets == nil {
		assets = []CmdbAsset{}
	}
	person.AssetCount = len(assets)
	return person, assets, rows.Err()
}

// TransferPersonAssets 一键批量交接人员名下的资产到新人员。
func (s *Store) TransferPersonAssets(req PersonTransferReq) (int, error) {
	if req.FromPersonID <= 0 || req.ToPersonID <= 0 {
		return 0, fmt.Errorf("必须指定移交人与接收人")
	}
	if req.FromPersonID == req.ToPersonID {
		return 0, fmt.Errorf("移交人与接收人不能为同一人")
	}

	fromPerson, err := s.GetPerson(req.FromPersonID)
	if err != nil {
		return 0, fmt.Errorf("移交人不存在: %w", err)
	}
	toPerson, err := s.GetPerson(req.ToPersonID)
	if err != nil {
		return 0, fmt.Errorf("接收人不存在: %w", err)
	}

	operator := req.Operator
	if strings.TrimSpace(operator) == "" {
		operator = "资产管理员"
	}
	remark := req.Remark
	if strings.TrimSpace(remark) == "" {
		remark = fmt.Sprintf("人员资产一键交接：从 [%s] 转交至 [%s]", fromPerson.Name, toPerson.Name)
	}

	// 确定待交接资产
	var targetIDs []int64
	if len(req.AssetIDs) > 0 {
		for _, id := range req.AssetIDs {
			targetIDs = append(targetIDs, id)
		}
	} else {
		// 未指定具体资产列表，交接移交人名下的全部资产
		rows, err := s.db.Query("SELECT id FROM cmdb_assets WHERE owner_id = ? OR (owner_id = 0 AND owner = ?)", fromPerson.ID, fromPerson.Name)
		if err != nil {
			return 0, err
		}
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return 0, err
			}
			targetIDs = append(targetIDs, id)
		}
		rows.Close()
	}

	if len(targetIDs) == 0 {
		return 0, nil
	}

	now := time.Now().Format("2006-01-02 15:04:05")
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	transferredCount := 0
	for _, assetID := range targetIDs {
		var oldOwner, oldDept, oldRoom, boxSN, srcType string
		var srcID int64
		err := tx.QueryRow(`
			SELECT IFNULL(owner,''), IFNULL(department,''), IFNULL(room,''), IFNULL(box_sn,''), IFNULL(source_type,'manual'), IFNULL(source_id,0)
			FROM cmdb_assets WHERE id = ?`, assetID).Scan(&oldOwner, &oldDept, &oldRoom, &boxSN, &srcType, &srcID)
		if err != nil {
			continue // 该资产不存在则跳过
		}

		// 更新 cmdb_assets
		_, err = tx.Exec(`
			UPDATE cmdb_assets
			SET owner_id = ?, owner = ?, department = ?, organization = ?, updated_at = ?
			WHERE id = ?`,
			toPerson.ID, toPerson.Name, toPerson.Department, toPerson.OrgName, now, assetID,
		)
		if err != nil {
			return 0, err
		}

		// 记录 asset_logs
		fromLoc := strings.TrimSpace(oldDept + " " + oldRoom)
		toLoc := strings.TrimSpace(toPerson.Department)
		_, _ = tx.Exec(`
			INSERT INTO asset_logs(asset_id, log_type, from_user, to_user, from_location, to_location, old_sn, new_sn, operator, description, log_time)
			VALUES(?, '调换使用人', ?, ?, ?, ?, '', '', ?, ?, ?)`,
			assetID, oldOwner, toPerson.Name, fromLoc, toLoc, operator, remark, now,
		)

		// 同步写穿到旧源台账
		if srcID > 0 {
			if srcType == "legacy_asset" {
				_, _ = tx.Exec("UPDATE assets SET user_name = ?, department = ?, updated_at = ? WHERE id = ?",
					toPerson.Name, toPerson.Department, now, srcID)
			} else if srcType == "legacy_server" {
				_, _ = tx.Exec("UPDATE servers SET admin_user = ?, updated_at = ? WHERE id = ?",
					toPerson.Name, now, srcID)
			}
		}

		transferredCount++
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return transferredCount, nil
}

// getAssetInterfaces 辅助读取资产的网卡接口。
func (s *Store) getAssetInterfaces(assetID int64) ([]CmdbAssetInterface, error) {
	rows, err := s.db.Query(`
		SELECT id, asset_id, IFNULL(asset_name,''), IFNULL(name,''), IFNULL(if_name,''),
		       IFNULL(ip,''), IFNULL(mask,''), IFNULL(gateway,''), IFNULL(mac,''),
		       IFNULL(network_zone,''), IFNULL(net_zone,''), is_primary, vlan_id, IFNULL(remark,'')
		FROM cmdb_asset_interfaces
		WHERE asset_id = ? ORDER BY is_primary DESC, id ASC`, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ifaces []CmdbAssetInterface
	for rows.Next() {
		var it CmdbAssetInterface
		if err := rows.Scan(
			&it.ID, &it.AssetID, &it.AssetName, &it.Name, &it.IfName,
			&it.IP, &it.Mask, &it.Gateway, &it.MAC,
			&it.NetworkZone, &it.NetZone, &it.IsPrimary, &it.VlanID, &it.Remark,
		); err != nil {
			return nil, err
		}
		if it.Name == "" && it.IfName != "" {
			it.Name = it.IfName
		}
		if it.IfName == "" && it.Name != "" {
			it.IfName = it.Name
		}
		if it.NetworkZone == "" && it.NetZone != "" {
			it.NetworkZone = it.NetZone
		}
		if it.NetZone == "" && it.NetworkZone != "" {
			it.NetZone = it.NetworkZone
		}
		ifaces = append(ifaces, it)
	}
	if ifaces == nil {
		ifaces = []CmdbAssetInterface{}
	}
	return ifaces, rows.Err()
}

