require("dotenv").config();
const mysql = require("mysql2/promise");

let pool = null;

function getPoolConfig() {
    const user = process.env.MYSQL_USER;
    const database = process.env.MYSQL_DATABASE;

    if (!user || !database) {
        throw new Error(
            "MySQL is not configured. Set MYSQL_USER and MYSQL_DATABASE in .env."
        );
    }

    return {
        host: process.env.MYSQL_HOST || "127.0.0.1",
        port: Number(process.env.MYSQL_PORT || 3306),
        user,
        password: process.env.MYSQL_PASSWORD || "",
        database,
        waitForConnections: true,
        connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
        namedPlaceholders: false,
        dateStrings: false,
    };
}

function getPool() {
    if (!pool) {
        pool = mysql.createPool(getPoolConfig());
    }
    return pool;
}

async function query(sql, params = []) {
    const [rows] = await getPool().execute(sql, params);
    return rows;
}

async function getConnection() {
    return getPool().getConnection();
}

async function connectDB() {
    try {
        const result = await query("SELECT 1 AS ok");
        if (!result?.[0]?.ok) {
            throw new Error("Unexpected response from MySQL");
        }
        console.log(
            `MariaDB/MySQL connected (${process.env.MYSQL_HOST || "127.0.0.1"}/${process.env.MYSQL_DATABASE})`
        );
    } catch (error) {
        console.error("MySQL connection error:", error.message);
        process.exit(1);
    }
}

module.exports = {
    connectDB,
    query,
    getConnection,
    getPool,
};
