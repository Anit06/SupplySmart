import { useEffect, useMemo, useState } from "react";
import { getAllPredictions } from "../../../services/aiService";
import "../../../assets/css/demandPrediction.css";

const monthNames = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
];

function DemandPrediction() {

    const [predictions, setPredictions] = useState([]);
    const [loading, setLoading] = useState(true);

    const [search, setSearch] = useState("");
    const [warehouse, setWarehouse] = useState("All");

    const filtered = useMemo(() => {
        let data = [...predictions];

        if (warehouse !== "All") {
            data = data.filter(
                item => item.warehouseName === warehouse
            );
        }

        if (search !== "") {

            data = data.filter(item =>

                item.productName
                    .toLowerCase()
                    .includes(search.toLowerCase())

            );

        }

        return data;
    }, [search, warehouse, predictions]);

    useEffect(() => {
        let active = true;

        getAllPredictions()
            .then((response) => {
                if (active) setPredictions(response.predictions || []);
            })
            .catch((error) => {
                console.log(error);
                if (active) alert("Unable to load predictions");
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    const warehouses = useMemo(() => {

        return [

            "All",

            ...new Set(
                predictions.map(item => item.warehouseName)
            )

        ];

    }, [predictions]);

    if (loading)
        return <h2>Loading AI Prediction...</h2>;

    return (

        <div className="prediction-page">

            <div className="prediction-header">

                <h2>

                    AI Demand Prediction

                </h2>

                <div className="prediction-count">

                    {filtered.length} Products

                </div>

            </div>

            <div className="prediction-filter">

                <input

                    placeholder="Search Product..."

                    value={search}

                    onChange={(e) =>
                        setSearch(e.target.value)
                    }

                />

                <select

                    value={warehouse}

                    onChange={(e) =>
                        setWarehouse(e.target.value)
                    }

                >

                    {

                        warehouses.map(item => (

                            <option
                                key={item}
                                value={item}
                            >

                                {item}

                            </option>

                        ))

                    }

                </select>

            </div>

            <div className="prediction-table-wrapper">

                <table className="prediction-table">

                    <thead>

                        <tr>

                            <th>#</th>
                            <th>Warehouse</th>
                            <th>Product</th>
                            <th>Category</th>
                            <th>Current</th>
                            <th>Last Year</th>
                            <th>Prediction</th>
                            <th>Month</th>

                        </tr>

                    </thead>

                    <tbody>

                        {

                            filtered.map((item, index) => (

                                <tr key={index}>

                                    <td>{index + 1}</td>

                                    <td>{item.warehouseName}</td>

                                    <td>{item.productName}</td>

                                    <td>{item.category}</td>

                                    <td>{item.currentMonthDemand}</td>

                                    <td>{item.sameMonthLastYearDemand}</td>

                                    <td>

                                        <span className="badge">

                                            {item.predictedDemand} Units

                                        </span>

                                    </td>

                                    <td>

                                        {

                                            monthNames[item.targetMonth]

                                        }

                                        {" "}

                                        {item.targetYear}

                                    </td>

                                </tr>

                            ))

                        }

                    </tbody>

                </table>

            </div>

        </div>

    );

}

export default DemandPrediction;