package store

// Legacy models for backward compatibility

type Asset struct {
	ID               int64  `json:"id"`
	AssetCode        string `json:"asset_code"`
	BoxSN            string `json:"box_sn"`
	DisplaySN        string `json:"display_sn"`
	UserName         string `json:"user_name"`
	Department       string `json:"department"`
	Room             string `json:"room"`
	IP               string `json:"ip"`
	TerminalIP       string `json:"terminal_ip"`
	SecuritySoftware string `json:"security_software"`
	Status           string `json:"status"`
	NetType          string `json:"net_type"`
	Remark           string `json:"remark"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

type PhysicalServer struct {
	ID               int64  `json:"id"`
	AssetCode        string `json:"asset_code"`
	DeviceName       string `json:"device_name"`
	BrandModel       string `json:"brand_model"`
	SerialNumber     string `json:"serial_number"`
	Location         string `json:"location"`
	RackUnit         string `json:"rack_unit"`
	CPUInfo          string `json:"cpu_info"`
	MemoryInfo       string `json:"memory_info"`
	DiskInfo         string `json:"disk_info"`
	MgmtIP           string `json:"mgmt_ip"`
	MgmtURL          string `json:"mgmt_url"`
	BizIP            string `json:"biz_ip"`
	OSType           string `json:"os_type"`
	AdminUser        string `json:"admin_user"`
	Status           string `json:"status"`
	PurchaseDate     string `json:"purchase_date"`
	WarrantyDate     string `json:"warranty_date"`
	Remark           string `json:"remark"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

type ServerApp struct {
	ID          int64  `json:"id"`
	ServerID    int64  `json:"server_id"`
	AppName     string `json:"app_name"`
	AppType     string `json:"app_type"`
	Port        string `json:"port"`
	Version     string `json:"version"`
	Status      string `json:"status"`
	Description string `json:"description"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type AssetLog struct {
	ID           int64  `json:"id"`
	AssetID      int64  `json:"asset_id"`
	LogType      string `json:"log_type"`
	FromUser     string `json:"from_user"`
	ToUser       string `json:"to_user"`
	FromLocation string `json:"from_location"`
	ToLocation   string `json:"to_location"`
	OldSN        string `json:"old_sn"`
	NewSN        string `json:"new_sn"`
	Operator     string `json:"operator"`
	Description  string `json:"description"`
	LogTime      string `json:"log_time"`
}

type SearchResult struct {
	Type       string `json:"type"`
	ID         int64  `json:"id"`
	Title      string `json:"title"`
	Subtitle   string `json:"subtitle"`
	Tag        string `json:"tag"`
	Status     string `json:"status"`
	Extra      string `json:"extra"`
	IP         string `json:"ip"`
	Department string `json:"department"`
}

type TransferReq struct {
	ToUser     string `json:"to_user"`
	ToLocation string `json:"to_location"`
	Operator   string `json:"operator"`
	Reason     string `json:"reason"`
}

type MaintenanceReq struct {
	Operator    string `json:"operator"`
	Description string `json:"description"`
	Status      string `json:"status"`
}

type IPEntry struct {
	ID         int64  `json:"id"`
	Subnet     string `json:"subnet"`
	IP         string `json:"ip"`
	Department string `json:"department"`
	Room       string `json:"room"`
	Account    string `json:"account"`
	Status     string `json:"status"`
	Remark     string `json:"remark"`
	AssetCode  string `json:"asset_code"`
	AssetUser  string `json:"asset_user"`
}
