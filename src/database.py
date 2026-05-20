"""Skills 数据库模块 - 使用 ctypes 加载 sqlite-vec 扩展"""

from pathlib import Path
from typing import Optional
import json
import threading
import sqlite3
import numpy as np
import ctypes
import ctypes.util


def _load_vec_via_ctypes(vec_path: str) -> bool:
    """
    使用 ctypes 直接加载 sqlite-vec 扩展
    绕过 SQLite authorizer 的限制
    """
    try:
        sqlite_lib_path = ctypes.util.find_library('sqlite3')
        if not sqlite_lib_path:
            return False
        
        sqlite = ctypes.CDLL(sqlite_lib_path)
        
        SQLITE_OK = 0
        
        sqlite.sqlite3_enable_load_extension.argtypes = [ctypes.c_void_p, ctypes.c_int]
        sqlite.sqlite3_enable_load_extension.restype = ctypes.c_int
        sqlite.sqlite3_load_extension.argtypes = [
            ctypes.c_void_p, 
            ctypes.c_char_p, 
            ctypes.c_char_p, 
            ctypes.POINTER(ctypes.c_char_p)
        ]
        sqlite.sqlite3_load_extension.restype = ctypes.c_int
        
        db = ctypes.c_void_p()
        result = sqlite.sqlite3_open(b':memory:', ctypes.byref(db))
        if result != SQLITE_OK:
            return False
        
        sqlite.sqlite3_enable_load_extension(db, 1)
        
        err_ptr = ctypes.c_char_p()
        result = sqlite.sqlite3_load_extension(
            db, 
            vec_path.encode(),
            None, 
            ctypes.byref(err_ptr)
        )
        sqlite.sqlite3_close(db)
        
        return result == SQLITE_OK
        
    except Exception:
        return False


class Skill:
    """Skill 数据模型"""

    def __init__(
        self,
        id: str,
        name: str,
        description: str = "",
        directory: str = "",
        tags: list[str] | None = None,
        repo_owner: Optional[str] = None,
        repo_name: Optional[str] = None,
        repo_branch: str = "main",
        readme_url: Optional[str] = None,
        content: str = "",
        metadata: dict | None = None,
        source: str = "unknown",
        installs: int = 0,
    ):
        self.id = id
        self.name = name
        self.description = description
        self.directory = directory
        self.tags = tags or []
        self.repo_owner = repo_owner
        self.repo_name = repo_name
        self.repo_branch = repo_branch
        self.readme_url = readme_url
        self.content = content
        self.metadata = metadata or {}
        self.source = source
        self.installs = installs


class SkillsDatabase:
    """
    Skills 检索数据库
    
    使用 SQLite + FTS5 + sqlite-vec 向量搜索
    通过 ctypes 绕过 macOS SIP 限制加载扩展
    """

    # ctypes SQLite 句柄（用于扩展加载）
    _ctypes_db: Optional[ctypes.c_void_p] = None
    _ctypes_lib: Optional[ctypes.CDLL] = None

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self._local = threading.local()
        self._vec_available = False
        self._embedding_dim = 768
        self._skills_columns: list[str] = []  # 缓存 skills 表列名
        
        self._load_extension_paths()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 初始化 ctypes SQLite 句柄
        self._init_ctypes()

    def _init_ctypes(self) -> None:
        """初始化 ctypes SQLite 连接"""
        try:
            sqlite_lib_path = ctypes.util.find_library('sqlite3')
            if not sqlite_lib_path:
                return
            
            self._ctypes_lib = ctypes.CDLL(sqlite_lib_path)
            
            SQLITE_OK = 0
            self._ctypes_lib.sqlite3_open.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
            self._ctypes_lib.sqlite3_open.restype = ctypes.c_int
            self._ctypes_lib.sqlite3_enable_load_extension.argtypes = [ctypes.c_void_p, ctypes.c_int]
            self._ctypes_lib.sqlite3_enable_load_extension.restype = ctypes.c_int
            self._ctypes_lib.sqlite3_load_extension.argtypes = [
                ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p,
                ctypes.POINTER(ctypes.c_char_p)
            ]
            self._ctypes_lib.sqlite3_load_extension.restype = ctypes.c_int
            self._ctypes_lib.sqlite3_exec.argtypes = [
                ctypes.c_void_p, ctypes.c_char_p, 
                ctypes.c_void_p, ctypes.c_void_p,
                ctypes.POINTER(ctypes.c_char_p)
            ]
            self._ctypes_lib.sqlite3_exec.restype = ctypes.c_int
            self._ctypes_lib.sqlite3_close.argtypes = [ctypes.c_void_p]
            self._ctypes_lib.sqlite3_close.restype = ctypes.c_int
            
            # prepare/step/finalize
            self._ctypes_lib.sqlite3_prepare_v2.argtypes = [
                ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int,
                ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_char_p)
            ]
            self._ctypes_lib.sqlite3_prepare_v2.restype = ctypes.c_int
            self._ctypes_lib.sqlite3_step.argtypes = [ctypes.c_void_p]
            self._ctypes_lib.sqlite3_step.restype = ctypes.c_int
            self._ctypes_lib.sqlite3_finalize.argtypes = [ctypes.c_void_p]
            self._ctypes_lib.sqlite3_finalize.restype = ctypes.c_int
            self._ctypes_lib.sqlite3_column_count.argtypes = [ctypes.c_void_p]
            self._ctypes_lib.sqlite3_column_count.restype = ctypes.c_int
            self._ctypes_lib.sqlite3_column_type.argtypes = [ctypes.c_void_p, ctypes.c_int]
            self._ctypes_lib.sqlite3_column_type.restype = ctypes.c_int
            self._ctypes_lib.sqlite3_column_int64.argtypes = [ctypes.c_void_p, ctypes.c_int]
            self._ctypes_lib.sqlite3_column_int64.restype = ctypes.c_int64
            self._ctypes_lib.sqlite3_column_double.argtypes = [ctypes.c_void_p, ctypes.c_int]
            self._ctypes_lib.sqlite3_column_double.restype = ctypes.c_double
            self._ctypes_lib.sqlite3_column_text.argtypes = [ctypes.c_void_p, ctypes.c_int]
            self._ctypes_lib.sqlite3_column_text.restype = ctypes.c_char_p
            self._ctypes_lib.sqlite3_column_name.argtypes = [ctypes.c_void_p, ctypes.c_int]
            self._ctypes_lib.sqlite3_column_name.restype = ctypes.c_char_p
            self._ctypes_lib.sqlite3_bind_text.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p]
            self._ctypes_lib.sqlite3_bind_text.restype = ctypes.c_int
            self._ctypes_lib.sqlite3_bind_int64.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int64]
            self._ctypes_lib.sqlite3_bind_int64.restype = ctypes.c_int
            self._ctypes_lib.sqlite3_bind_double.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_double]
            self._ctypes_lib.sqlite3_bind_double.restype = ctypes.c_int
            
            # 打开数据库
            db = ctypes.c_void_p()
            result = self._ctypes_lib.sqlite3_open(
                str(self.db_path).encode(), 
                ctypes.byref(db)
            )
            if result != SQLITE_OK:
                return
            
            # 启用扩展加载并加载 vec0
            self._ctypes_lib.sqlite3_enable_load_extension(db, 1)
            
            if self._vec_ext:
                err_ptr = ctypes.c_char_p()
                result = self._ctypes_lib.sqlite3_load_extension(
                    db, 
                    self._vec_ext.encode(),
                    None, 
                    ctypes.byref(err_ptr)
                )
                if result == SQLITE_OK:
                    self._vec_available = True
            
            self._ctypes_db = db
            self._initialized = False  # 标记尚未初始化
            
        except Exception:
            pass
    
    def _exec_ctypes(self, sql: str) -> bool:
        """通过 ctypes 执行 SQL"""
        if not self._ctypes_db or not self._ctypes_lib:
            return False
        
        err_ptr = ctypes.c_char_p()
        result = self._ctypes_lib.sqlite3_exec(
            self._ctypes_db,
            sql.encode(),
            None, None,
            ctypes.byref(err_ptr)
        )
        return result == 0
    
    def _close_ctypes(self) -> None:
        """关闭 ctypes 连接，切换到标准 sqlite3 连接"""
        if self._ctypes_db and self._ctypes_lib:
            self._ctypes_lib.sqlite3_close(self._ctypes_db)
            self._ctypes_db = None
            self._ctypes_lib = None

    def _load_extension_paths(self) -> None:
        """加载 sqlite-vec 扩展路径"""
        try:
            import sqlite_vec
            ext_dir = Path(sqlite_vec.__file__).parent
            self._vec_ext = str(ext_dir / "vec0.dylib")
            
            # 获取 embedding 维度
            try:
                from skills_search_mcp.config import settings
                self._embedding_dim = settings.embedding_dim or 768
            except Exception:
                self._embedding_dim = 768
                
        except ImportError:
            self._vec_ext = None

    def _exec_sql(self, sql: str) -> None:
        """执行 SQL（线程安全）"""
        conn = self.conn
        conn.execute(sql)
        conn.commit()

    @property
    def conn(self) -> sqlite3.Connection:
        """线程安全的连接"""
        if not hasattr(self._local, "conn") or self._local.conn is None:
            conn = sqlite3.connect(
                str(self.db_path),
                check_same_thread=False,
            )
            conn.row_factory = sqlite3.Row
            self._local.conn = conn
        return self._local.conn

    def initialize(self) -> None:
        """初始化数据库"""
        # 通过 ctypes 执行所有 SQL（保持扩展加载状态）
        
        # 创建向量表（如果 vec0 可用）
        if self._vec_available:
            self._exec_ctypes(f"""
                CREATE VIRTUAL TABLE IF NOT EXISTS skills_vec USING vec0(
                    embedding float[{self._embedding_dim}]
                )
            """)

        # 1. skills 元数据表
        self._exec_ctypes("""
            CREATE TABLE IF NOT EXISTS skills (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                directory TEXT NOT NULL,
                tags TEXT DEFAULT '[]',
                repo_owner TEXT,
                repo_name TEXT,
                repo_branch TEXT DEFAULT 'main',
                readme_url TEXT,
                content TEXT DEFAULT '',
                metadata TEXT DEFAULT '{}',
                source TEXT DEFAULT 'unknown',
                installs INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        """)

        # 2. FTS5 全文检索表
        self._exec_ctypes("""
            CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
                name,
                description,
                tags,
                content,
                content='skills',
                content_rowid='rowid'
            )
        """)

        # 3. FTS 触发器
        self._exec_ctypes("""
            CREATE TRIGGER IF NOT EXISTS skills_fts_insert
            AFTER INSERT ON skills BEGIN
                INSERT INTO skills_fts(rowid, name, description, tags, content)
                VALUES (NEW.rowid, NEW.name, NEW.description, NEW.tags, NEW.content);
            END
        """)
        self._exec_ctypes("""
            CREATE TRIGGER IF NOT EXISTS skills_fts_delete
            AFTER DELETE ON skills BEGIN
                INSERT INTO skills_fts(skills_fts, rowid, name, description, tags, content)
                VALUES ('delete', OLD.rowid, OLD.name, OLD.description, OLD.tags, OLD.content);
            END
        """)
        self._exec_ctypes("""
            CREATE TRIGGER IF NOT EXISTS skills_fts_update
            AFTER UPDATE ON skills BEGIN
                INSERT INTO skills_fts(skills_fts, rowid, name, description, tags, content)
                VALUES ('delete', OLD.rowid, OLD.name, OLD.description, OLD.tags, OLD.content);
                INSERT INTO skills_fts(rowid, name, description, tags, content)
                VALUES (NEW.rowid, NEW.name, NEW.description, NEW.tags, NEW.content);
            END
        """)

        # 4. 配置表
        self._exec_ctypes("""
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        
        # 缓存 skills 表的列名
        self._load_skills_columns()
        
        # 初始化完成，切换到标准 sqlite3 连接
        # 保存 ctypes 连接参数以便后续向量操作
        self._ctypes_db_path = str(self.db_path)
        self._ctypes_vec_ext = self._vec_ext
        self._ctypes_embedding_dim = self._embedding_dim
        self._close_ctypes()
        self._initialized = True
    
    def _get_vec_conn(self) -> Optional[ctypes.c_void_p]:
        """获取带有 vec0 扩展的 ctypes 数据库连接"""
        if not self._ctypes_db_path or not self._ctypes_vec_ext:
            return None
        
        try:
            lib = ctypes.CDLL(ctypes.util.find_library('sqlite3'))
            
            # 设置函数签名
            lib.sqlite3_open.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
            lib.sqlite3_open.restype = ctypes.c_int
            lib.sqlite3_close.argtypes = [ctypes.c_void_p]
            lib.sqlite3_close.restype = ctypes.c_int
            lib.sqlite3_enable_load_extension.argtypes = [ctypes.c_void_p, ctypes.c_int]
            lib.sqlite3_enable_load_extension.restype = ctypes.c_int
            lib.sqlite3_load_extension.argtypes = [
                ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p,
                ctypes.POINTER(ctypes.c_char_p)
            ]
            lib.sqlite3_load_extension.restype = ctypes.c_int
            lib.sqlite3_exec.argtypes = [
                ctypes.c_void_p, ctypes.c_char_p, 
                ctypes.c_void_p, ctypes.c_void_p,
                ctypes.POINTER(ctypes.c_char_p)
            ]
            lib.sqlite3_exec.restype = ctypes.c_int
            
            # 打开数据库
            db = ctypes.c_void_p()
            result = lib.sqlite3_open(self._ctypes_db_path.encode(), ctypes.byref(db))
            if result != 0:
                return None
            
            # 启用扩展并加载 vec0
            lib.sqlite3_enable_load_extension(db, 1)
            err_ptr = ctypes.c_char_p()
            result = lib.sqlite3_load_extension(
                db, 
                self._ctypes_vec_ext.encode(),
                None, 
                ctypes.byref(err_ptr)
            )
            if result != 0:
                lib.sqlite3_close(db)
                return None
            
            # 保存 lib 引用以便后续使用
            db._lib = lib
            return db
            
        except Exception:
            return None
    
    def _exec_vec_sql(self, db: ctypes.c_void_p, sql: str) -> bool:
        """在 vec 连接上执行 SQL"""
        err_ptr = ctypes.c_char_p()
        result = db._lib.sqlite3_exec(db, sql.encode(), None, None, ctypes.byref(err_ptr))
        return result == 0
    
    def _load_skills_columns(self) -> None:
        """加载并缓存 skills 表的列名"""
        stmt = ctypes.c_void_p()
        tail = ctypes.c_char_p()
        result = self._ctypes_lib.sqlite3_prepare_v2(
            self._ctypes_db,
            b"SELECT * FROM skills LIMIT 0",
            -1,
            ctypes.byref(stmt),
            ctypes.byref(tail)
        )
        if result == 0:
            ncols = self._ctypes_lib.sqlite3_column_count(stmt)
            self._skills_columns = [
                self._ctypes_lib.sqlite3_column_name(stmt, i).decode()
                for i in range(ncols)
            ]
        self._ctypes_lib.sqlite3_finalize(stmt)

    def upsert_skill(self, skill: Skill) -> None:
        """插入或更新 skill"""
        conn = self.conn
        conn.execute(
            """
            INSERT OR REPLACE INTO skills
            (id, name, description, directory, tags, repo_owner, repo_name,
             repo_branch, readme_url, content, metadata, source, installs, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    COALESCE((SELECT created_at FROM skills WHERE id = ?), strftime('%s', 'now')),
                    strftime('%s', 'now'))
            """,
            (
                skill.id,
                skill.name,
                skill.description,
                skill.directory,
                json.dumps(skill.tags),
                skill.repo_owner,
                skill.repo_name,
                skill.repo_branch,
                skill.readme_url,
                skill.content,
                json.dumps(skill.metadata),
                skill.source,
                skill.installs,
                skill.id,
            ),
        )
        conn.commit()

    def search_bm25(self, query: str, limit: int = 20) -> list[dict]:
        """BM25 全文检索"""
        conn = self.conn
        try:
            results = conn.execute(
                """
                SELECT s.*, bm25(skills_fts) as bm25_rank
                FROM skills_fts f
                JOIN skills s ON s.rowid = f.rowid
                WHERE skills_fts MATCH ?
                ORDER BY bm25_rank
                LIMIT ?
                """,
                (query, limit),
            )
            return [dict(row) for row in results]
        except sqlite3.OperationalError:
            return []

    def upsert_embedding(self, skill_id: str, embedding: list[float]) -> None:
        """存储向量到 sqlite-vec"""
        conn = self.conn
        
        # 获取 skill 的 rowid
        cursor = conn.execute("SELECT rowid FROM skills WHERE id = ?", (skill_id,))
        row = cursor.fetchone()
        if not row:
            return
        
        rowid = row[0]
        
        if self._vec_available:
            # 通过 ctypes 连接执行（需要 vec0 扩展）
            vec_db = self._get_vec_conn()
            if vec_db:
                lib = vec_db._lib
                
                # 准备语句
                stmt = ctypes.c_void_p()
                lib.sqlite3_prepare_v2.argtypes = [
                    ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int,
                    ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_char_p)
                ]
                lib.sqlite3_prepare_v2.restype = ctypes.c_int
                lib.sqlite3_bind_int64.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int64]
                lib.sqlite3_bind_int64.restype = ctypes.c_int
                lib.sqlite3_bind_blob64.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint64, ctypes.c_void_p]
                lib.sqlite3_bind_blob64.restype = ctypes.c_int
                lib.sqlite3_step.argtypes = [ctypes.c_void_p]
                lib.sqlite3_step.restype = ctypes.c_int
                lib.sqlite3_finalize.argtypes = [ctypes.c_void_p]
                lib.sqlite3_finalize.restype = ctypes.c_int
                
                lib.sqlite3_prepare_v2(
                    vec_db, 
                    b'INSERT OR REPLACE INTO skills_vec(rowid, embedding) VALUES (?, ?)',
                    -1, ctypes.byref(stmt), None
                )
                
                # 转换 embedding 为 BLOB
                import struct
                emb_bytes = struct.pack(f'{len(embedding)}f', *embedding)
                
                lib.sqlite3_bind_int64(stmt, 1, rowid)
                lib.sqlite3_bind_blob64(
                    stmt, 2, 
                    ctypes.cast(emb_bytes, ctypes.c_void_p), 
                    len(emb_bytes), None
                )
                
                lib.sqlite3_step(stmt)
                lib.sqlite3_finalize(stmt)
                
                lib.sqlite3_close(vec_db)
    
    def _get_column_names(self, stmt: ctypes.c_void_p) -> list[str]:
        """获取列名"""
        ncols = self._ctypes_lib.sqlite3_column_count(stmt)
        return [
            self._ctypes_lib.sqlite3_column_name(stmt, i).decode()
            for i in range(ncols)
        ]

    def _query_ctypes(self, sql: str) -> Optional[tuple]:
        """通过 ctypes 执行查询并返回结果"""
        # 如果 ctypes 未初始化（初始化后已关闭），返回 None
        if not self._ctypes_db or not self._ctypes_lib:
            return None
        
        # 使用 sqlite3_prepare_v2 和 sqlite3_step 获取结果
        stmt = ctypes.c_void_p()
        tail = ctypes.c_char_p()
        result = self._ctypes_lib.sqlite3_prepare_v2(
            self._ctypes_db,
            sql.encode(),
            -1,
            ctypes.byref(stmt),
            ctypes.byref(tail)
        )
        if result != 0:
            return None
        
        # 执行并获取结果
        results = []
        SQLITE_ROW = 100
        while self._ctypes_lib.sqlite3_step(stmt) == SQLITE_ROW:
            row = []
            ncols = self._ctypes_lib.sqlite3_column_count(stmt)
            for i in range(ncols):
                col_type = self._ctypes_lib.sqlite3_column_type(stmt, i)
                if col_type == 1:  # NULL
                    row.append(None)
                elif col_type == 2:  # INTEGER
                    row.append(self._ctypes_lib.sqlite3_column_int64(stmt, i))
                elif col_type == 3:  # REAL
                    row.append(self._ctypes_lib.sqlite3_column_double(stmt, i))
                elif col_type == 4:  # TEXT
                    text = self._ctypes_lib.sqlite3_column_text(stmt, i)
                    row.append(text.decode() if text else None)
                elif col_type == 5:  # BLOB
                    blob = self._ctypes_lib.sqlite3_column_blob(stmt, i)
                    size = self._ctypes_lib.sqlite3_column_bytes(stmt, i)
                    row.append(ctypes.string_at(blob, size) if blob else None)
                else:
                    row.append(None)
            results.append(row)
        
        self._ctypes_lib.sqlite3_finalize(stmt)
        
        if not results:
            return None
        
        # 获取列名
        # 重新执行一次查询获取列名
        stmt = ctypes.c_void_p()
        self._ctypes_lib.sqlite3_prepare_v2(self._ctypes_db, sql.encode(), -1, ctypes.byref(stmt), None)
        self._ctypes_lib.sqlite3_step(stmt)
        col_names = self._get_column_names(stmt)
        self._ctypes_lib.sqlite3_finalize(stmt)
        
        return (col_names, results)

    def search_vector(
        self,
        embedding: list[float],
        limit: int = 20,
    ) -> list[dict]:
        """向量相似度检索"""
        if not self._vec_available:
            return []
        
        # 通过 ctypes 连接执行（需要 vec0 扩展）
        vec_db = self._get_vec_conn()
        if not vec_db:
            return []
        
        try:
            lib = vec_db._lib
            
            # 设置函数签名
            lib.sqlite3_prepare_v2.argtypes = [
                ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int,
                ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_char_p)
            ]
            lib.sqlite3_prepare_v2.restype = ctypes.c_int
            lib.sqlite3_bind_blob64.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint64, ctypes.c_void_p]
            lib.sqlite3_bind_blob64.restype = ctypes.c_int
            lib.sqlite3_step.argtypes = [ctypes.c_void_p]
            lib.sqlite3_step.restype = ctypes.c_int
            lib.sqlite3_column_int64.argtypes = [ctypes.c_void_p, ctypes.c_int]
            lib.sqlite3_column_int64.restype = ctypes.c_int64
            lib.sqlite3_column_double.argtypes = [ctypes.c_void_p, ctypes.c_int]
            lib.sqlite3_column_double.restype = ctypes.c_double
            lib.sqlite3_finalize.argtypes = [ctypes.c_void_p]
            lib.sqlite3_finalize.restype = ctypes.c_int
            
            # 构建查询 SQL - 只查询 rowid 和 distance
            import struct
            emb_bytes = struct.pack(f'{len(embedding)}f', *embedding)
            
            sql = f"""
                SELECT v.rowid, v.distance
                FROM skills_vec v
                WHERE v.embedding = ?
                ORDER BY v.distance
                LIMIT {limit}
            """
            
            # 执行查询
            stmt = ctypes.c_void_p()
            tail = ctypes.c_char_p()
            prep_result = lib.sqlite3_prepare_v2(vec_db, sql.encode(), -1, ctypes.byref(stmt), ctypes.byref(tail))
            
            # 绑定 embedding BLOB
            bind_result = lib.sqlite3_bind_blob64(
                stmt, 1,
                ctypes.cast(emb_bytes, ctypes.c_void_p),
                len(emb_bytes), None
            )
            
                        # 读取 rowid 和 distance
            rowids = []
            distances = []
            step_count = 0
            while True:
                step_result = lib.sqlite3_step(stmt)
                step_count += 1
                if step_result == 100:  # SQLITE_ROW
                    rowid = lib.sqlite3_column_int64(stmt, 0)
                    distance = lib.sqlite3_column_double(stmt, 1)
                    rowids.append(rowid)
                    distances.append(distance)
                else:
                    break
            
            lib.sqlite3_finalize(stmt)
            
            # 关闭 vec 连接
            vec_db._lib.sqlite3_close(vec_db)
            vec_db = None
            
            if not rowids:
                return []
            
            placeholders = ','.join('?' * len(rowids))
            conn = self.conn
            cursor = conn.execute(
                f"""
                SELECT rowid, id, name, description, directory, tags, 
                       repo_owner, repo_name, repo_branch, readme_url,
                       content, metadata, source, installs, created_at, updated_at
                FROM skills WHERE rowid IN ({placeholders})
                """,
                rowids
            )
            
            # 建立 rowid -> 数据的映射
            row_map = {}
            for row in cursor.fetchall():
                row_map[row['rowid']] = dict(row)
            
            # 组装结果
            results = []
            for rowid, distance in zip(rowids, distances):
                if rowid in row_map:
                    result = row_map[rowid]
                    result['distance'] = distance
                    results.append(result)
            
            return results
            
        except Exception:
            return []

    def get_skill(self, skill_id: str) -> Optional[dict]:
        """获取单个 skill"""
        conn = self.conn
        cursor = conn.execute("SELECT * FROM skills WHERE id = ?", (skill_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_all_skills(
        self, limit: int = 100, offset: int = 0, source: Optional[str] = None
    ) -> list[dict]:
        """获取所有 skills"""
        conn = self.conn
        if source:
            cursor = conn.execute(
                "SELECT * FROM skills WHERE source = ? ORDER BY name LIMIT ? OFFSET ?",
                (source, limit, offset),
            )
        else:
            cursor = conn.execute(
                "SELECT * FROM skills ORDER BY name LIMIT ? OFFSET ?",
                (limit, offset),
            )
        return [dict(row) for row in cursor.fetchall()]

    def get_stats(self) -> dict:
        """获取统计信息"""
        conn = self.conn

        cursor = conn.execute("SELECT COUNT(*) FROM skills")
        skill_count = cursor.fetchone()[0]

        indexed_count = 0
        if self._vec_available:
            try:
                cursor = conn.execute("SELECT COUNT(*) FROM skills_vec")
                indexed_count = cursor.fetchone()[0]
            except Exception:
                pass

        cursor = conn.execute(
            "SELECT source, COUNT(*) FROM skills GROUP BY source"
        )
        source_stats = dict(cursor.fetchall())

        return {
            "total_skills": skill_count,
            "indexed_skills": indexed_count,
            "unindexed_skills": skill_count - indexed_count,
            "vec_available": self._vec_available,
            "source_stats": source_stats,
            "db_path": str(self.db_path),
            "db_size_mb": (
                self.db_path.stat().st_size / 1024 / 1024
                if self.db_path.exists()
                else 0
            ),
        }

    def get_config(self, key: str) -> Optional[str]:
        """获取配置"""
        conn = self.conn
        cursor = conn.execute("SELECT value FROM config WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row[0] if row else None

    def set_config(self, key: str, value: str) -> None:
        """设置配置"""
        conn = self.conn
        conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
            (key, value),
        )
        conn.commit()

    def close(self) -> None:
        """关闭连接"""
        if hasattr(self._local, "conn") and self._local.conn:
            self._local.conn.close()
            self._local.conn = None