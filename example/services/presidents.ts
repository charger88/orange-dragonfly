interface President {
    id: number
    name: string
}

const DATA: Map<number, President> = new Map([
    [1, { id: 1, name: 'George Washington' }],
    [2, { id: 2, name: 'John Adams' }],
    [3, { id: 3, name: 'Thomas Jefferson' }],
    [4, { id: 4, name: 'James Madison' }],
    [5, { id: 5, name: 'James Monroe' }],
    [6, { id: 6, name: 'John Quincy Adams' }],
    [7, { id: 7, name: 'Andrew Jackson' }],
    [8, { id: 8, name: 'Martin Van Buren' }],
    [9, { id: 9, name: 'William Henry Harrison' }],
    [10, { id: 10, name: 'John Tyler' }],
    [11, { id: 11, name: 'James K. Polk' }],
    [12, { id: 12, name: 'Zachary Taylor' }],
    [13, { id: 13, name: 'Millard Fillmore' }],
    [14, { id: 14, name: 'Franklin Pierce' }],
    [15, { id: 15, name: 'James Buchanan' }],
    [16, { id: 16, name: 'Abraham Lincoln' }],
    [17, { id: 17, name: 'Andrew Johnson' }],
    [18, { id: 18, name: 'Ulysses S. Grant' }],
    [19, { id: 19, name: 'Rutherford B. Hayes' }],
    [20, { id: 20, name: 'James A. Garfield' }],
    [21, { id: 21, name: 'Chester A. Arthur' }],
    [22, { id: 22, name: 'Grover Cleveland' }],
    [23, { id: 23, name: 'Benjamin Harrison' }],
    [24, { id: 24, name: 'Grover Cleveland' }],
    [25, { id: 25, name: 'William McKinley' }],
    [26, { id: 26, name: 'Theodore Roosevelt' }],
    [27, { id: 27, name: 'William Howard Taft' }],
    [28, { id: 28, name: 'Woodrow Wilson' }],
    [29, { id: 29, name: 'Warren G. Harding' }],
    [30, { id: 30, name: 'Calvin Coolidge' }],
    [31, { id: 31, name: 'Herbert Hoover' }],
    [32, { id: 32, name: 'Franklin D. Roosevelt' }],
    [33, { id: 33, name: 'Harry S. Truman' }],
    [34, { id: 34, name: 'Dwight D. Eisenhower' }],
    [35, { id: 35, name: 'John F. Kennedy' }],
    [36, { id: 36, name: 'Lyndon B. Johnson' }],
    [37, { id: 37, name: 'Richard Nixon' }],
    [38, { id: 38, name: 'Gerald Ford' }],
    [39, { id: 39, name: 'Jimmy Carter' }],
    [40, { id: 40, name: 'Ronald Reagan' }],
    [41, { id: 41, name: 'George H. W. Bush' }],
    [42, { id: 42, name: 'Bill Clinton' }],
    [43, { id: 43, name: 'George W. Bush' }],
    [44, { id: 44, name: 'Barack Obama' }],
])

let nextId = 45

export default class PresidentsService {
    getById(id: number): President | null {
        return DATA.get(id) ?? null
    }

    create(name: string): President {
        const president: President = { id: nextId++, name }
        DATA.set(president.id, president)
        return president
    }

    deleteById(id: number): boolean {
        return DATA.delete(id)
    }

    getList(offset: number = 0, limit: number = 10): President[] {
        return Array.from(DATA.values()).slice(offset, offset + limit)
    }

    getByName(name: string): President | null {
        for (const president of DATA.values()) {
            if (president.name === name) return president
        }
        return null
    }
}