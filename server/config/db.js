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
        // DATETIME has no zone. Every JS Date is written and read as UTC so the
        // export is identical no matter where the app or the analyst's machine
        // is, and so rows the app writes agree with rows the DB stamps itself.
        timezone: "Z",
    };
}

function getPool() {
    if (!pool) {
        pool = mysql.createPool(getPoolConfig());
        // Columns defaulting to CURRENT_TIMESTAMP use the session zone, which
        // would otherwise be whatever the database server happens to run in.
        pool.on("connection", (connection) => {
            connection.query("SET time_zone = '+00:00'");
        });
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
