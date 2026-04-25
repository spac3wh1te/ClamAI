import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Users,
  UserPlus,
  Trash2,
  Edit3,
  Key,
  Shield,
  ShieldCheck,
  UserX,
  Loader2,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

interface UserInfo {
  id: string;
  username: string;
  display_name: string;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_login_at?: string;
}

function UserManagement() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<UserInfo | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ username: "", password: "", display_name: "", role: "user" });
  const [resetPassword, setResetPassword] = useState("");
  const [regOpen, setRegOpen] = useState(false);

  const { data: usersData, refetch } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const raw = await invoke<string>("list_users");
      const parsed = JSON.parse(raw);
      return (parsed.users || []) as UserInfo[];
    },
  });

  useQuery({
    queryKey: ["registration-open"],
    queryFn: async () => {
      const raw = await invoke<string>("get_auth_status");
      const parsed = JSON.parse(raw);
      setRegOpen(parsed.registration_open === true);
      return parsed;
    },
  });

  const users = usersData || [];

  const createMutation = useMutation({
    mutationFn: () =>
      invoke("create_user", {
        username: newUser.username,
        password: newUser.password,
        displayName: newUser.display_name || undefined,
        role: newUser.role,
      }),
    onSuccess: () => {
      setShowCreate(false);
      setNewUser({ username: "", password: "", display_name: "", role: "user" });
      refetch();
    },
    onError: (e: any) => alert("创建失败: " + e),
  });

  const updateMutation = useMutation({
    mutationFn: (u: UserInfo) =>
      invoke("update_user", {
        id: u.id,
        displayName: u.display_name,
        role: u.role,
        status: u.status,
      }),
    onSuccess: () => {
      setEditingUser(null);
      refetch();
    },
    onError: (e: any) => alert("更新失败: " + e),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => invoke("delete_user", { id }),
    onSuccess: () => refetch(),
    onError: (e: any) => alert("删除失败: " + e),
  });

  const resetMutation = useMutation({
    mutationFn: ({ id, pw }: { id: string; pw: string }) =>
      invoke("reset_user_password", { id, newPassword: pw }),
    onSuccess: () => {
      setResettingUserId(null);
      setResetPassword("");
    },
    onError: (e: any) => alert("重置失败: " + e),
  });

  const regToggleMutation = useMutation({
    mutationFn: (open: boolean) => invoke("set_registration_open", { open }),
    onSuccess: (_, open) => setRegOpen(open),
    onError: (e: any) => alert("设置失败: " + e),
  });

  const roleBadge = (role: string) =>
    role === "admin" ? (
      <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary flex items-center gap-1">
        <ShieldCheck className="w-3 h-3" />
        管理员
      </span>
    ) : (
      <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-1">
        <UserX className="w-3 h-3" />
        普通用户
      </span>
    );

  const statusBadge = (status: string) =>
    status === "active" ? (
      <span className="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-500">正常</span>
    ) : (
      <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-500">禁用</span>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">用户管理</h2>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1 px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <UserPlus className="w-4 h-4" />
            新建用户
          </button>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium">开放注册</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              允许新用户自行注册账号，注册后为普通用户角色
            </p>
          </div>
          <button
            onClick={() => regToggleMutation.mutate(!regOpen)}
            className="flex items-center gap-2 text-sm"
          >
            {regOpen ? (
              <ToggleRight className="w-8 h-8 text-green-500" />
            ) : (
              <ToggleLeft className="w-8 h-8 text-muted-foreground" />
            )}
            <span className={regOpen ? "text-green-500" : "text-muted-foreground"}>
              {regOpen ? "已开放" : "已关闭"}
            </span>
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="bg-card rounded-lg border border-border p-4 space-y-4">
          <h4 className="text-sm font-medium">新建用户</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">用户名</label>
              <input
                type="text"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                placeholder="登录用户名"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">密码</label>
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                placeholder="至少6位"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">显示名称</label>
              <input
                type="text"
                value={newUser.display_name}
                onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                placeholder="可选"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">角色</label>
              <select
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!newUser.username || newUser.password.length < 6 || createMutation.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 text-sm"
            >
              {createMutation.isPending ? "创建中..." : "创建"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">用户列表</span>
          <span className="text-xs text-muted-foreground ml-auto">{users.length} 个用户</span>
        </div>
        <div className="divide-y divide-border">
          {users.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无用户</div>
          )}
          {users.map((user) => (
            <div key={user.id} className="px-4 py-3">
              {editingUser?.id === user.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">显示名称</label>
                      <input
                        type="text"
                        value={editingUser.display_name}
                        onChange={(e) => setEditingUser({ ...editingUser, display_name: e.target.value })}
                        className="w-full px-3 py-1.5 bg-background border border-border rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">角色</label>
                      <select
                        value={editingUser.role}
                        onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                        className="w-full px-3 py-1.5 bg-background border border-border rounded text-sm"
                      >
                        <option value="user">普通用户</option>
                        <option value="admin">管理员</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">状态</label>
                      <select
                        value={editingUser.status}
                        onChange={(e) => setEditingUser({ ...editingUser, status: e.target.value })}
                        className="w-full px-3 py-1.5 bg-background border border-border rounded text-sm"
                      >
                        <option value="active">正常</option>
                        <option value="disabled">禁用</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateMutation.mutate(editingUser)}
                      className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs hover:bg-primary/90"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setEditingUser(null)}
                      className="px-3 py-1 bg-secondary text-secondary-foreground rounded text-xs"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                    {user.display_name?.[0] || user.username[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{user.display_name || user.username}</span>
                      {roleBadge(user.role)}
                      {statusBadge(user.status)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      @{user.username}
                      {user.last_login_at && ` | 上次登录: ${new Date(user.last_login_at).toLocaleString("zh-CN")}`}
                      {user.created_at && ` | 创建于: ${new Date(user.created_at).toLocaleString("zh-CN")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditingUser({ ...user })}
                      className="p-1.5 text-muted-foreground hover:text-primary"
                      title="编辑"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setResettingUserId(user.id); setResetPassword(""); }}
                      className="p-1.5 text-muted-foreground hover:text-orange-500"
                      title="重置密码"
                    >
                      <Key className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { if (confirm(`确定要删除用户 ${user.username} 吗？`)) deleteMutation.mutate(user.id); }}
                      className="p-1.5 text-muted-foreground hover:text-red-500"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
              {resettingUserId === user.id && (
                <div className="mt-3 flex items-center gap-2 pl-11">
                  <input
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    className="px-3 py-1.5 bg-background border border-border rounded text-sm flex-1 max-w-xs"
                    placeholder="输入新密码（至少6位）"
                  />
                  <button
                    onClick={() => resetMutation.mutate({ id: user.id, pw: resetPassword })}
                    disabled={resetPassword.length < 6}
                    className="px-3 py-1.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600 disabled:opacity-50"
                  >
                    确认重置
                  </button>
                  <button
                    onClick={() => { setResettingUserId(null); setResetPassword(""); }}
                    className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded text-xs"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default UserManagement;
