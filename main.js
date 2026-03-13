const fs = require("fs");


function getShiftDuration(startTime, endTime) {

    function toSeconds(time) {
        let parts = time.split(" ");
        let timePart = parts[0];
        let period = parts[1];

        let [h, m, s] = timePart.split(":").map(Number);

        if (period === "pm" && h !== 12) h += 12;
        if (period === "am" && h === 12) h = 0;

        return h * 3600 + m * 60 + s;
    }

    let start = toSeconds(startTime);
    let end = toSeconds(endTime);

    let diff = end - start;

    let hours = Math.floor(diff / 3600);
    diff %= 3600;

    let minutes = Math.floor(diff / 60);
    let seconds = diff % 60;

    return `${hours}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
}


function getIdleTime(startTime, endTime) {

    function toSeconds(time) {
        let [timePart, period] = time.split(" ");
        let [h, m, s] = timePart.split(":").map(Number);

        if (period === "pm" && h !== 12) h += 12;
        if (period === "am" && h === 12) h = 0;

        return h*3600 + m*60 + s;
    }

    let start = toSeconds(startTime);
    let end = toSeconds(endTime);

    const startWindow = 8 * 3600;
    const endWindow = 22 * 3600;

    let idle = 0;

    if (start < startWindow) {
        idle += Math.min(end, startWindow) - start;
    }

    if (end > endWindow) {
        idle += end - Math.max(start, endWindow);
    }

    let h = Math.floor(idle/3600);
    idle %= 3600;

    let m = Math.floor(idle/60);
    let s = idle % 60;

    return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}


function getActiveTime(shiftDuration, idleTime) {

    function toSeconds(time) {
        let [h, m, s] = time.split(":").map(Number);
        return h*3600 + m*60 + s;
    }

    let shift = toSeconds(shiftDuration);
    let idle = toSeconds(idleTime);

    let active = shift - idle;

    let h = Math.floor(active/3600);
    active %= 3600;

    let m = Math.floor(active/60);
    let s = active % 60;

    return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}



function metQuota(date, activeTime) {

    function toSeconds(time){
        let [h,m,s] = time.split(":").map(Number);
        return h*3600 + m*60 + s;
    }

    let active = toSeconds(activeTime);

    let normalQuota = 8*3600 + 24*60;
    let eidQuota = 6*3600;

    let d = new Date(date);
    let eidStart = new Date("2025-04-10");
    let eidEnd = new Date("2025-04-30");

    let quota = (d >= eidStart && d <= eidEnd) ? eidQuota : normalQuota;

    return active >= quota;
}


function addShiftRecord(textFile, shiftObj) {
    const { driverID, driverName, date, startTime, endTime } = shiftObj;

    let lines = [];
    try {
        const raw = fs.readFileSync(textFile, 'utf8');
        lines = raw.split('\n').filter(l => l.trim() !== '');
    } catch (e) {}

    for (const line of lines) {
        const cols = line.split(',');
        if (cols[0].trim() === driverID && cols[2].trim() === date) return {};
    }

    const shiftDuration = getShiftDuration(startTime, endTime);
    const idleTime = getIdleTime(startTime, endTime);
    const activeTime = getActiveTime(shiftDuration, idleTime);
    const quota = metQuota(date, activeTime);

    const newLine = [driverID, driverName, date, startTime, endTime, shiftDuration, idleTime, activeTime, quota, false].join(',');

    const lastIdx = lines.reduce((acc, line, i) => line.split(',')[0].trim() === driverID ? i : acc, -1);

    if (lastIdx === -1) {
        lines.push(newLine);
    } else {
        lines.splice(lastIdx + 1, 0, newLine);
    }

    fs.writeFileSync(textFile, lines.join('\n') + '\n', 'utf8');

    return { driverID, driverName, date, startTime, endTime, shiftDuration, idleTime, activeTime, metQuota: quota, hasBonus: false };
}

function setBonus(textFile, driverID, date, newValue) {
    const lines = fs.readFileSync(textFile, 'utf8').split('\n');

    const updated = lines.map(line => {
        if (line.trim() === '') return line;
        const cols = line.split(',');
        if (cols[0].trim() === driverID && cols[2].trim() === date) {
            cols[9] = newValue.toString();
            return cols.join(',');
        }
        return line;
    });

    fs.writeFileSync(textFile, updated.join('\n'), 'utf8');
}

function countBonusPerMonth(textFile, driverID, month) {
    const lines = fs.readFileSync(textFile, 'utf8').split('\n').filter(l => l.trim() !== '');
    const targetMonth = parseInt(month, 10);
    let found = false;
    let count = 0;

    for (const line of lines) {
        const cols = line.split(',');
        if (cols[0].trim() !== driverID) continue;
        found = true;
        if (parseInt(cols[2].trim().split('-')[1], 10) === targetMonth && cols[9].trim().toLowerCase() === 'true') count++;
    }

    return found ? count : -1;
}

function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    const lines = fs.readFileSync(textFile, 'utf8').split('\n').filter(l => l.trim() !== '');
    let totalSec = 0;

    for (const line of lines) {
        const cols = line.split(',');
        if (cols[0].trim() !== driverID) continue;
        if (parseInt(cols[2].trim().split('-')[1], 10) !== month) continue;
        const [h, m, s] = cols[7].trim().split(':').map(Number);
        totalSec += h * 3600 + m * 60 + s;
    }

    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    const rateLines = fs.readFileSync(rateFile, 'utf8').split('\n').filter(l => l.trim() !== '');
    const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

    let dayOff = -1;
    for (const line of rateLines) {
        const cols = line.split(',');
        if (cols[0].trim() === driverID) { dayOff = dayMap[cols[1].trim().toLowerCase()]; break; }
    }

    const lines = fs.readFileSync(textFile, 'utf8').split('\n').filter(l => l.trim() !== '');
    let totalSec = 0;

    for (const line of lines) {
        const cols = line.split(',');
        if (cols[0].trim() !== driverID) continue;
        const dateStr = cols[2].trim();
        if (parseInt(dateStr.split('-')[1], 10) !== month) continue;
        const d = new Date(dateStr);
        if (d.getDay() === dayOff) continue;
        const day = d.getDate();
        totalSec += (month === 4 && day >= 10 && day <= 30) ? 6 * 3600 : 8 * 3600 + 24 * 60;
    }

    totalSec = Math.max(0, totalSec - bonusCount * 2 * 3600);

    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    const rateLines = fs.readFileSync(rateFile, 'utf8').split('\n').filter(l => l.trim() !== '');

    let basePay = 0, tier = 1;
    for (const line of rateLines) {
        const cols = line.split(',');
        if (cols[0].trim() === driverID) { basePay = parseInt(cols[2].trim(), 10); tier = parseInt(cols[3].trim(), 10); break; }
    }

    const toSec = str => { const [h, m, s] = str.trim().split(':').map(Number); return h * 3600 + m * 60 + s; };
    const allowance = { 1: 50, 2: 20, 3: 10, 4: 3 }[tier] * 3600;
    const missingSec = Math.max(0, toSec(requiredHours) - toSec(actualHours));

    if (missingSec <= allowance) return basePay;

    const billableHours = Math.floor((missingSec - allowance) / 3600);
    return basePay - billableHours * Math.floor(basePay / 185);
}

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};
